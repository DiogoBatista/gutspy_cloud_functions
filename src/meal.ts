import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { ProcessingStatus, WeeklySummary } from "./types";
import { UserGoals } from "./user";

export interface NutritionalReport {
  image_recognition: {
    name: string;
  };
  ingredient_extraction: string[];
  ingredient_categorization: Record<string, never>;
  nutritional_information: {
    calories: string;
    macronutrients: {
      carbohydrates: string;
      proteins: string;
      fats: string;
    };
    micronutrients: {
      vitamins: {
        vitaminC: string;
        vitaminA: string;
      };
      minerals: {
        potassium: string;
        magnesium: string;
      };
    };
  };
  caloric_breakdown: {
    carbohydrates: string;
    proteins: string;
    fats: string;
  };
  description: string;
}

export enum ImageCheckType {
  meals = "meals",
  digestions = "digestions",
  profile = "profile",
}

export interface ImageCheckRecord {
  id: string;
  userID: string;
  filename: string;
  status: ProcessingStatus;
  nutritional_report: NutritionalReport;
  processed_at: Timestamp | null;
  created_at: Timestamp;
  type: ImageCheckType;
}

/**
 * Analyzes nutrition data from meal records
 * @param {Object[]} mealRecords - Array of meal records to analyze
 * @param {UserGoals} userGoals - User's goals for comparison
 * @return {Object} Weekly nutrition analysis
 */
export async function analyzeNutrition(
  mealRecords: ImageCheckRecord[],
  userGoals: UserGoals
): Promise<WeeklySummary["nutritionAnalysis"]> {
  console.log("MEAL RECORDS:", mealRecords);

  const totalCalories = mealRecords.reduce(
    (sum, record) => sum + Number(record.nutritional_report.caloric_breakdown.carbohydrates),
    0
  );
  const totalProtein = mealRecords.reduce(
    (sum, record) => sum + Number(record.nutritional_report.caloric_breakdown.proteins),
    0
  );
  const totalCarbs = mealRecords.reduce(
    (sum, record) => sum + Number(record.nutritional_report.caloric_breakdown.carbohydrates),
    0
  );
  const totalFat = mealRecords.reduce(
    (sum, record) => sum + Number(record.nutritional_report.caloric_breakdown.fats),
    0
  );

  const mealsCount = mealRecords.length;
  const averageCaloriesPerMeal = mealsCount > 0 ? totalCalories / mealsCount : 0;

  const dailyNutrition = mealRecords.reduce(
    (acc, record) => {
      const day = record.created_at.toDate().toLocaleDateString();

      if (!acc[day]) {
        acc[day] = {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
        };
      }
      acc[day].calories += Number(record.nutritional_report.caloric_breakdown.carbohydrates);
      acc[day].protein += Number(record.nutritional_report.caloric_breakdown.proteins);
      acc[day].carbs += Number(record.nutritional_report.caloric_breakdown.carbohydrates);
      acc[day].fat += Number(record.nutritional_report.caloric_breakdown.fats);
      return acc;
    },
    {} as Record<
      string,
      {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
      }
    >
  );

  const daysWithRecords = Object.keys(dailyNutrition).length;

  // Calculate average macros
  const averageMacros = {
    proteins: daysWithRecords > 0 ? Math.round(totalProtein / daysWithRecords) : 0,
    carbs: daysWithRecords > 0 ? Math.round(totalCarbs / daysWithRecords) : 0,
    fats: daysWithRecords > 0 ? Math.round(totalFat / daysWithRecords) : 0,
  };

  // Get most common ingredients (placeholder - would need actual ingredient tracking)
  const commonIngredients = extractCommonIngredients(mealRecords);

  return {
    totalCalories,
    averageMacros,
    commonIngredients,
    mealsCount,
    averageCaloriesPerMeal,
    daysMetCalorieTarget: Object.values(dailyNutrition).filter(
      (day) => day.calories >= userGoals.calories
    ).length,
    daysMetProteinTarget: Object.values(dailyNutrition).filter(
      (day) => day.protein >= userGoals.macros.proteins
    ).length,
    daysMetCarbsTarget: Object.values(dailyNutrition).filter(
      (day) => day.carbs >= userGoals.macros.carbs
    ).length,
    daysMetFatTarget: Object.values(dailyNutrition).filter(
      (day) => day.fat >= userGoals.macros.fats
    ).length,
  };
}

/**
 * Extracts common ingredients from meal records
 * @param {Object[]} meals - Array of meal records
 * @return {string[]} Array of common ingredients
 */
function extractCommonIngredients(meals: ImageCheckRecord[]): string[] {
  // Implementation to extract and count common ingredients
  // Return top N most frequent ingredients

  const ingredientCounts: Record<string, number> = {};

  meals.forEach((meal) => {
    meal.nutritional_report.ingredient_extraction.forEach((ingredient) => {
      ingredientCounts[ingredient] = (ingredientCounts[ingredient] || 0) + 1;
    });
  });

  return Object.entries(ingredientCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ingredient]) => ingredient);
}

/**
 * Fetches meal records for a user within a date range
 * @param {string} userId - The ID of the user
 * @param {Object} start - Start date of the range
 * @param {Object} end - End date of the range
 * @return {Promise<ImageCheckRecord[]>} Array of meal records
 */
export async function fetchMealRecords(
  userId: string,
  start: admin.firestore.Timestamp,
  end: admin.firestore.Timestamp
) {
  const snapshot = await admin
    .firestore()
    .collection("meal_records")
    .where("userID", "==", userId)
    .where("created_at", ">=", start)
    .where("created_at", "<=", end)
    .where("status", "==", "processed") // Only get processed records
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as ImageCheckRecord[];
}
