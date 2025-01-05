import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { UserGoals } from "./user";
import { ProcessingStatus, WeeklySummary } from "./types";

export type DigestionConsistency = "solid" | "semi-solid" | "liquid";
export type DigestionColor = "brown" | "yellow" | "green" | "red" | "black" | "other";

export type DigestionShape = "Regular" | "Irregular";
export type DigestionSize = "Small" | "Medium" | "Large";
export type DigestionSource = "manual" | "ai";

export enum ImageCheckType {
  meals = "meals",
  digestions = "digestions",
  profile = "profile",
}

export interface DigestionAnalysis {
  bristol_scale: string;
  color: string;
  consistency: string;
  shape: string;
  size: string;
  has_blood: boolean;
  has_mucus: boolean;
  source: DigestionSource;
}

export interface DigestionRecord {
  id: string;
  userID: string;
  created_at: Timestamp;
  type: ImageCheckType;
  status: ProcessingStatus;
  filename?: string;
  notes?: string;

  // The main analysis data
  analysis: DigestionAnalysis;

  // AI-specific additional data
  ai_recommendations?: string[];
  ai_concerns?: string[];
}

/**
 * Analyzes digestion records and generates a weekly digestion summary
 * @param {DigestionRecord[]} digestionRecords The array of digestion records
 * @param {UserGoals} userGoals The user's goals for comparison
 */
export async function analyzeDigestion(
  digestionRecords: DigestionRecord[],
  userGoals: UserGoals
): Promise<WeeklySummary["digestionAnalysis"]> {
  console.log("DIGESTION RECORDS:", digestionRecords);

  const frequency = digestionRecords.length;

  const bristolScaleDistribution = digestionRecords.reduce(
    (acc, record) => {
      const score = record.analysis.bristol_scale.toString();
      acc[score] = (acc[score] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const dailyScores = digestionRecords.reduce(
    (acc, record) => {
      const day = record.created_at.toDate().toLocaleDateString();
      if (!acc[day]) {
        acc[day] = [];
      }
      acc[day].push(Number(record.analysis.bristol_scale));
      return acc;
    },
    {} as Record<string, number[]>
  );

  // Calculate average scores by day
  const averageScoresByDay = Object.entries(dailyScores).reduce(
    (acc, [day, scores]) => {
      acc[day] = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      return acc;
    },
    {} as Record<string, number>
  );

  // Identify any concerns based on bristol scores
  const concerns: string[] = [];
  const idealRange = {
    min: userGoals.bristol_score - 1,
    max: userGoals.bristol_score + 1,
  };

  Object.entries(averageScoresByDay).forEach(([day, score]) => {
    if (score < idealRange.min) {
      concerns.push(`Low bristol score on ${day}: ${score.toFixed(1)}`);
    } else if (score > idealRange.max) {
      concerns.push(`High bristol score on ${day}: ${score.toFixed(1)}`);
    }
  });

  return {
    frequency,
    bristolScaleDistribution,
    commonCharacteristics: {
      colors: [],
      consistencies: [],
    },
    concerns,
  };
}

/**
 * Fetches digestion records for a user within a date range
 * @param {string} userId - The ID of the user
 * @param {Object} start - Start date of the range
 * @param {Object} end - End date of the range
 * @return {Promise<DigestionRecord[]>} Array of digestion records
 */
export async function fetchDigestionRecords(
  userId: string,
  start: admin.firestore.Timestamp,
  end: admin.firestore.Timestamp
) {
  const snapshot = await admin
    .firestore()
    .collection("digestion_records")
    .where("userID", "==", userId)
    .where("created_at", ">=", start)
    .where("created_at", "<=", end)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as DigestionRecord[];
}
