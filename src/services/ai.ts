import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { DigestionRecord } from "../digestion";
import { ImageCheckRecord } from "../meal";
import { WaterIntakeRecord } from "../water";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

/**
 * Get API key from environment variables, trying Firebase Config first, then falling back to process.env
 * @return {string} The API key from environment variables
 * @throws {Error} If no API key is found in any environment
 */
function getApiKey(): string {
  // Get API key from environment variables
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. Make sure to set it in .env for development or using firebase functions:secrets:set for production."
    );
  }

  return apiKey;
}

// Get and validate API key
const validatedApiKey: string = getApiKey();

/** Interface for digestion analysis results */
export interface DigestionAnalysisResult {
  analysis: {
    color: string;
    consistency: string;
    shape: string;
    size: string;
    presence_of_blood: boolean;
    presence_of_mucus: boolean;
    bristol_stool_scale: number;
  };
  concerns: string[];
  recommendations: string[];
  summary: string;
}

/** Interface for meal analysis results */
export interface MealAnalysisResult {
  image_recognition: {
    name: string;
  };
  ingredient_extraction: string[];
  ingredient_categorization: Record<string, string[]>;
  nutritional_information: {
    calories: number;
    macronutrients: {
      carbohydrates: number;
      proteins: number;
      fats: number;
    };
    micronutrients: {
      vitamins: {
        vitaminC: number;
        vitaminA: number;
      };
      minerals: {
        potassium: number;
        magnesium: number;
      };
    };
  };
  caloric_breakdown: {
    carbohydrates: number;
    proteins: number;
    fats: number;
  };
  description: string;
}

/** Interface for correlation analysis results */
export interface CorrelationAnalysisResult {
  waterAndDigestion: string[];
  dietAndDigestion: string[];
}

/** Service class for handling AI operations using Gemini */
export class AIService {
  private static instance: AIService;
  private model: GenerativeModel;

  /**
   * Private constructor to enforce singleton pattern
   * @return {void}
   */
  private constructor() {
    const genAi = new GoogleGenerativeAI(validatedApiKey);
    this.model = genAi.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  /**
   * Get the singleton instance of AIService
   * @return {AIService} The singleton instance
   */
  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  /**
   * Analyze an image with a given prompt using Gemini AI
   * @param {string} base64Image - Base64 encoded image data
   * @param {string} prompt - Prompt for the AI analysis
   * @return {Promise<Record<string, unknown>>} Promise resolving to the analysis result
   */
  private async analyzeImage<T>(base64Image: string, prompt: string): Promise<T> {
    const image = {
      inlineData: {
        data: base64Image,
        mimeType: "image/png",
      },
    };

    const result = await this.model.generateContent([prompt, image]);
    const responseText = result.response.text();

    // Extract JSON from markdown response
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error("Could not find JSON content in response");
    }

    const jsonContent = jsonMatch[1];
    return JSON.parse(jsonContent) as T;
  }

  /**
   * Analyze text with a given prompt using Gemini AI
   * @param {string} prompt - Prompt for the AI analysis
   * @return {Promise<Record<string, unknown>>} Promise resolving to the analysis result
   */
  private async analyzeText<T>(prompt: string): Promise<T> {
    const result = await this.model.generateContent([prompt]);
    const responseText = result.response.text();

    // Extract JSON from markdown response
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error("Could not find JSON content in response");
    }

    const jsonContent = jsonMatch[1];
    return JSON.parse(jsonContent) as T;
  }

  /**
   * Analyze a meal image to extract nutritional information
   * @param {string} base64Image - Base64 encoded image data
   * @return {Promise<MealAnalysisResult>} Promise resolving to the meal analysis result
   */
  async analyzeMealImage(base64Image: string): Promise<MealAnalysisResult> {
    const foodCategoriesJsonString = JSON.stringify(
      {
        fruits: [],
        vegetables: [],
        grains: [],
        proteins: {
          meats: [],
          poultry: [],
          "fish and seafood": [],
          eggs: [],
          legumes: [],
          "nuts and seeds": [],
        },
        "dairy and non-dairy alternatives": {
          milk: [],
          cheese: [],
          yogurt: [],
          "plant-based milks": [],
        },
        "fats and oils": [],
        "herbs and spices": [],
        sweeteners: [],
        beverages: [],
        "condiments and sauces": [],
        "baking and cooking ingredients": [],
        "snacks and sweets": [],
        "prepared and processed foods": [],
        "whole meals": [],
      },
      null,
      2
    );

    const outputFormat = JSON.stringify(
      {
        image_recognition: {
          name: "",
        },
        ingredient_extraction: [],
        ingredient_categorization: {},
        nutritional_information: {
          calories: "",
          macronutrients: {
            carbohydrates: "",
            proteins: "",
            fats: "",
          },
          micronutrients: {
            vitamins: {
              vitaminC: "",
              vitaminA: "",
            },
            minerals: {
              potassium: "",
              magnesium: "",
            },
          },
        },
        caloric_breakdown: {
          carbohydrates: "",
          proteins: "",
          fats: "",
        },
        description: "",
      },
      null,
      2
    );

    const prompt =
      "Given an image provided, assume that you are working for an app and do the following: " +
      "Image Recognition: Utilize advanced image recognition technology to analyze user-uploaded food images. The system should be capable of identifying the dish presented in the image with high accuracy. " +
      "Ingredient Extraction: Once the dish is identified, deploy a food recognition algorithm to dissect the image and determine the individual ingredients that make up the dish. The algorithm should be trained on a comprehensive dataset of food images and their corresponding ingredients to ensure broad coverage of various cuisines and dish types. " +
      "Ingredient Categorization: Organize the extracted ingredients into standard food categories. " +
      "These categories may include, but are not limited to, the following: " +
      foodCategoriesJsonString +
      "Nutritional Information: Provide numerical values only for nutritional information. All measurements should be in grams (g) for macronutrients, milligrams (mg) for micronutrients, and absolute numbers for calories. Do not include text descriptions, ranges, or approximations - use single numerical values even if estimated. " +
      "Caloric Breakdown: Calculate specific numerical values for the caloric content. Provide exact numbers for the breakdown of calories by macronutrient (carbohydrates, proteins, fats), avoiding any text descriptions or ranges. " +
      "Description: Generate a tentative name for the dish and a brief description based on the identified ingredients. " +
      "Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text, notes, or explanations. All nutritional values must be numbers, not strings or text descriptions: " +
      outputFormat +
      " The ultimate goal is to provide users with an informative and engaging experience that helps them understand the composition of their meals and encourages informed dietary choices. Remember to provide ONLY the JSON response without any additional commentary or markdown formatting, and ensure all nutritional values are numerical.";

    return this.analyzeImage<MealAnalysisResult>(base64Image, prompt);
  }

  /**
   * Analyze a digestion image to assess health indicators
   * @param {string} base64Image - Base64 encoded image data
   * @return {Promise<DigestionAnalysisResult>} Promise resolving to the digestion analysis result
   */
  async analyzeDigestionImage(base64Image: string): Promise<DigestionAnalysisResult> {
    const outputFormat = JSON.stringify(
      {
        analysis: {
          color: "",
          consistency: "",
          shape: "",
          size: "",
          presence_of_blood: false,
          presence_of_mucus: false,
          bristol_stool_scale: 0,
        },
        concerns: [],
        recommendations: [],
        summary: "",
      },
      null,
      2
    );

    const prompt =
      "As an AI medical expert specializing in gastroenterology, analyze the provided image of a bowel movement. " +
      "Perform the following analysis with clinical precision: " +
      "1. Visual Assessment: Evaluate the stool's physical characteristics including color, consistency, shape, and size. " +
      "2. Clinical Indicators: Identify any concerning elements such as the presence of blood, mucus, or abnormal coloration. " +
      "3. Bristol Stool Scale Classification: Determine the type according to the Bristol Stool Form Scale (1-7). " +
      "4. Medical Concerns: List any potential health concerns based on the visual analysis. " +
      "5. Recommendations: Provide relevant medical recommendations if concerns are identified. " +
      "Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text or explanations: " +
      outputFormat;

    return this.analyzeImage<DigestionAnalysisResult>(base64Image, prompt);
  }

  /**
   * Analyze manually entered digestion data
   * @param {object} data - Manual digestion data
   * @param {string} data.bristol_scale - Bristol scale type
   * @param {string} data.color - Stool color
   * @param {string} data.consistency - Stool consistency
   * @param {string} data.shape - Stool shape
   * @param {string} data.size - Stool size
   * @param {boolean} data.has_blood - Presence of blood
   * @param {boolean} data.has_mucus - Presence of mucus
   * @return {Promise<DigestionAnalysisResult>} Promise resolving to the digestion analysis result
   */
  async analyzeDigestionData(data: {
    bristol_scale: string;
    color: string;
    consistency: string;
    shape: string;
    size: string;
    has_blood: boolean;
    has_mucus: boolean;
  }): Promise<DigestionAnalysisResult> {
    const outputFormat = JSON.stringify(
      {
        analysis: {
          color: "",
          consistency: "",
          shape: "",
          size: "",
          presence_of_blood: false,
          presence_of_mucus: false,
          bristol_stool_scale: 0,
        },
        concerns: [],
        recommendations: [],
        summary: "",
      },
      null,
      2
    );

    const prompt =
      "As an AI medical expert specializing in gastroenterology, analyze the following stool characteristics and provide medical insights: " +
      `Bristol Scale: Type ${data.bristol_scale}\n` +
      `Color: ${data.color}\n` +
      `Consistency: ${data.consistency}\n` +
      `Shape: ${data.shape}\n` +
      `Size: ${data.size}\n` +
      `Presence of Blood: ${data.has_blood}\n` +
      `Presence of Mucus: ${data.has_mucus}\n\n` +
      "Based on these characteristics:\n" +
      "1. Clinical Assessment: Evaluate the stool characteristics for any potential health implications.\n" +
      "2. Medical Concerns: List any potential health concerns based on the provided characteristics.\n" +
      "3. Recommendations: Provide relevant medical recommendations based on the analysis.\n" +
      "Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text or explanations: " +
      outputFormat +
      " Ensure all responses are clinical and professional in nature. The analysis should focus on providing actionable medical insights while maintaining medical accuracy and professionalism.";

    return this.analyzeText<DigestionAnalysisResult>(prompt);
  }

  /**
   * Generates correlations between water, meal, and digestion records using AI analysis
   * @param {WaterIntakeRecord[]} waterRecords - Array of water intake records
   * @param {ImageCheckRecord[]} mealRecords - Array of meal records
   * @param {DigestionRecord[]} digestionRecords - Array of digestion records
   * @return {Promise<CorrelationAnalysisResult>} Promise resolving to the correlation analysis result
   */
  async generateCorrelations(
    waterRecords: WaterIntakeRecord[],
    mealRecords: ImageCheckRecord[],
    digestionRecords: DigestionRecord[]
  ): Promise<CorrelationAnalysisResult> {
    // Prepare the data for analysis
    const analysisData = {
      water_intake: waterRecords.map((record) => ({
        amount: record.amount,
        timestamp: record.created_at.toDate().toISOString(),
      })),
      meals: mealRecords.map((record) => ({
        timestamp: record.created_at.toDate().toISOString(),
        nutritional_report: record.nutritional_report,
      })),
      digestion: digestionRecords.map((record) => ({
        bristol_scale: record.analysis.bristol_scale,
        timestamp: record.created_at.toDate().toISOString(),
        characteristics: {
          color: record.analysis.color,
          consistency: record.analysis.consistency,
          has_blood: record.analysis.has_blood,
          has_mucus: record.analysis.has_mucus,
        },
      })),
    };

    const outputFormat = JSON.stringify(
      {
        waterAndDigestion: [
          "Correlation between water intake and digestion patterns",
          // Additional insights will be added by AI
        ],
        dietAndDigestion: [
          "Correlation between dietary patterns and digestion",
          // Additional insights will be added by AI
        ],
      },
      null,
      2
    );

    const prompt = `As a medical expert specializing in gastroenterology and nutrition, analyze the following week's health data and identify meaningful correlations and patterns:

${JSON.stringify(analysisData, null, 2)}

Focus on:
1. Water Intake & Digestion Correlations:
   - Analyze how water consumption patterns affect digestion timing and quality
   - Identify optimal hydration patterns that correlate with healthy digestion
   - Note any delays or improvements in digestion based on water intake

2. Diet & Digestion Correlations:
   - Examine how meal timing and composition affect digestion patterns
   - Identify foods or eating patterns that correlate with better or worse digestion
   - Note any consistent delays between meals and digestion events

Provide insights in a clear, actionable format. Focus on strong correlations and patterns that could be useful for improving health outcomes.

Output: Respond ONLY with a JSON object that matches exactly the following template, without any additional text or explanations:
${outputFormat}

Each array should contain 3-5 clear, specific observations about correlations found in the data. If no clear correlations are found, provide appropriate cautionary statements about insufficient data or weak correlations.`;

    try {
      return this.analyzeText<CorrelationAnalysisResult>(prompt);
    } catch (error) {
      console.error("Failed to generate correlations:", error);
      return {
        waterAndDigestion: ["Unable to generate correlations due to analysis error"],
        dietAndDigestion: ["Unable to generate correlations due to analysis error"],
      };
    }
  }
}
