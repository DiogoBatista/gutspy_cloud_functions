import { Timestamp } from "firebase-admin/firestore";

export interface WeeklySummary {
  userID: string;
  weekStartDate: Timestamp;
  weekEndDate: Timestamp;

  waterAnalysis?: {
    totalIntake: number;
    dailyAverage: number;
    daysMetTarget: number;
  };

  nutritionAnalysis?: {
    totalCalories: number;
    averageMacros: {
      carbs: number;
      proteins: number;
      fats: number;
    };
    commonIngredients: string[];
    mealsCount: number;
    averageCaloriesPerMeal: number;
    daysMetCalorieTarget: number;
    daysMetProteinTarget: number;
    daysMetCarbsTarget: number;
    daysMetFatTarget: number;
  };

  digestionAnalysis: {
    frequency: number;
    bristolScaleDistribution: Record<string, number>;
    commonCharacteristics: {
      colors: string[];
      consistencies: string[];
    };
    concerns: string[];
  };

  correlations: {
    waterAndDigestion: string[];
    dietAndDigestion: string[];
  };

  created_at: Timestamp;
}

export enum ImageCheckType {
  meals = "meals",
  digestions = "digestions",
  profile = "profile",
}

export enum ProcessingStatus {
  to_be_processed = "to_be_processed",
  processing = "processing",
  processed = "processed",
  failed = "failed",
}
