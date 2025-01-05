import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { WeeklySummary } from "./types";
import { UserGoals } from "./user";

export interface WaterIntakeRecord {
  id: string;
  amount: number;
  notes?: string;
  created_at: Timestamp;
  userID: string;
}

/**
 * Analyzes water intake records and generates a weekly summary
 * @param {WaterIntakeRecord[]} waterRecords - Array of water intake records
 * @param {UserGoals} userGoals - User's goals for comparison
 */
export async function analyzeWaterIntake(
  waterRecords: WaterIntakeRecord[],
  userGoals: UserGoals
): Promise<WeeklySummary["waterAnalysis"]> {
  console.log("WATER RECORDS:", waterRecords);

  const totalIntake = waterRecords.reduce((sum, record) => sum + record.amount, 0);

  console.log("TOTAL INTAKE:", totalIntake);

  const dailyIntakes = waterRecords.reduce(
    (acc, record) => {
      const day = record.created_at.toDate().toLocaleDateString();
      acc[day] = (acc[day] || 0) + record.amount;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log("DAILY INTAKES:", dailyIntakes);

  const daysWithRecords = Object.keys(dailyIntakes).length;
  const dailyAverage = daysWithRecords > 0 ? totalIntake / daysWithRecords : 0;

  return {
    totalIntake,
    dailyAverage,
    daysMetTarget: Object.values(dailyIntakes).filter((amount) => amount >= userGoals.water).length,
  };
}

/**
 * Fetches water intake records for a user within a date range
 * @param {string} userId - The ID of the user
 * @param {Object} start - Start date of the range
 * @param {Object} end - End date of the range
 */
export async function fetchWaterRecords(
  userId: string,
  start: admin.firestore.Timestamp,
  end: admin.firestore.Timestamp
) {
  const snapshot = await admin
    .firestore()
    .collection("water_records")
    .where("userID", "==", userId)
    .where("created_at", ">=", start)
    .where("created_at", "<=", end)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as WaterIntakeRecord[];
}
