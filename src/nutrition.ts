import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { WeeklySummary } from "./types";
import { UserGoals } from "./user";

export interface MealRecord {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at: Timestamp;
  userID: string;
}

/**
 * Analyzes meal records and generates a weekly nutrition summary
 * @param {MealRecord[]} mealRecords - Array of meal records
 * @param {UserGoals} userGoals - User's goals for comparison
 */
export async function analyzeNutrition(
  mealRecords: MealRecord[],
  userGoals: UserGoals
): Promise<WeeklySummary["nutritionAnalysis"]> {
  console.log("MEAL RECORDS:", mealRecords);

  const totalCalories = mealRecords.reduce((sum, record) => sum + record.calories, 0);
  const totalProtein = mealRecords.reduce((sum, record) => sum + record.protein, 0);
  const totalCarbs = mealRecords.reduce((sum, record) => sum + record.carbs, 0);
  const totalFat = mealRecords.reduce((sum, record) => sum + record.fat, 0);

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
      acc[day].calories += record.calories;
      acc[day].protein += record.protein;
      acc[day].carbs += record.carbs;
      acc[day].fat += record.fat;
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
    proteins: daysWithRecords > 0 ? totalProtein / daysWithRecords : 0,
    carbs: daysWithRecords > 0 ? totalCarbs / daysWithRecords : 0,
    fats: daysWithRecords > 0 ? totalFat / daysWithRecords : 0,
  };

  // Get most common ingredients (placeholder - would need actual ingredient tracking)
  const commonIngredients: string[] = [];

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
 * Fetches meal records for a user within a date range
 * @param {string} userId - The ID of the user
 * @param {Object} start - Start date of the range
 * @param {Object} end - End date of the range
 * @return {Promise<MealRecord[]>} Array of meal records
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
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as MealRecord[];
}
