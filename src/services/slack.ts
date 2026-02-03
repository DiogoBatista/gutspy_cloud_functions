import * as admin from "firebase-admin";

/** True when Cloud Functions are running in the Firebase Emulator (firebase emulators:start). */
/** @return {boolean} True when Cloud Functions are running in the Firebase Emulator (firebase emulators:start). */
function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/** Prefix for Slack messages when running in emulator so they are clearly test traffic. */
const EMULATOR_PREFIX = "[EMULATOR] ";

/**
 * Service for sending Slack notifications when users create meal and digestion records
 */
export class SlackService {
  private static instance: SlackService;
  private webhookUrl: string;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    // Get Slack webhook URL from environment variables
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL || "";
  }

  /**
   * Prefixes text with the emulator prefix if running in emulator
   * @param {string} text - The text to prefix
   * @return {string} The prefixed text
   */
  private prefix(text: string): string {
    return isEmulator() ? EMULATOR_PREFIX + text : text;
  }

  /**
   * Gets the singleton instance of SlackService
   * @return {SlackService} The singleton instance
   */
  public static getInstance(): SlackService {
    if (!SlackService.instance) {
      SlackService.instance = new SlackService();
    }
    return SlackService.instance;
  }

  /**
   * Sends a notification to Slack when a meal is created
   * @param {string} userId - The user ID who created the meal
   * @param {string} mealId - The meal record ID
   * @param {string} mealName - The name of the meal (if available)
   */
  async notifyMealCreated(userId: string, mealId: string, mealName?: string): Promise<void> {
    if (!this.webhookUrl) {
      console.log("Slack webhook URL not configured, skipping meal notification");
      return;
    }

    try {
      // Get user info if possible
      let userEmail = "Unknown user";
      try {
        const userRecord = await admin.auth().getUser(userId);
        userEmail = userRecord.email || "Unknown user";
      } catch (error) {
        console.log("Could not fetch user info for Slack notification:", error);
      }

      const body = `*New meal recorded!* 🍽️\n\n*User:* ${userEmail}\n*User ID:* \`${userId}\`\n*Meal ID:* \`${mealId}\`${mealName ? `\n*Meal:* ${mealName}` : ""}\n*Time:* ${new Date().toLocaleString()}`;
      const message = {
        text: this.prefix("🍽️ New meal recorded!"),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: this.prefix(body),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: isEmulator() ? "GutSpy App Activity (emulator)" : "GutSpy App Activity",
              },
            ],
          },
        ],
      };

      await this.sendToSlack(message);
    } catch (error) {
      console.error("Failed to send meal notification to Slack:", error);
    }
  }

  /**
   * Sends a notification to Slack when a digestion record is created
   * @param {string} userId - The user ID who created the digestion record
   * @param {string} digestionId - The digestion record ID
   * @param {string} source - The source of the digestion record (ai/manual)
   */
  async notifyDigestionCreated(userId: string, digestionId: string, source: string): Promise<void> {
    if (!this.webhookUrl) {
      console.log("Slack webhook URL not configured, skipping digestion notification");
      return;
    }

    try {
      // Get user info if possible
      let userEmail = "Unknown user";
      try {
        const userRecord = await admin.auth().getUser(userId);
        userEmail = userRecord.email || "Unknown user";
      } catch (error) {
        console.log("Could not fetch user info for Slack notification:", error);
      }

      const emoji = source === "ai" ? "🤖" : "✍️";
      const sourceText = source === "ai" ? "AI Analysis" : "Manual Entry";
      const body = `*New digestion record!* 💩\n\n*User:* ${userEmail}\n*User ID:* \`${userId}\`\n*Record ID:* \`${digestionId}\`\n*Source:* ${emoji} ${sourceText}\n*Time:* ${new Date().toLocaleString()}`;
      const message = {
        text: this.prefix("💩 New digestion record!"),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: this.prefix(body),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: isEmulator() ? "GutSpy App Activity (emulator)" : "GutSpy App Activity",
              },
            ],
          },
        ],
      };

      await this.sendToSlack(message);
    } catch (error) {
      console.error("Failed to send digestion notification to Slack:", error);
    }
  }

  /**
   * Sends a notification to Slack when a symptom log is created
   * @param {string} userId - The user ID who created the symptom log
   * @param {string} symptomLogId - The symptom log document ID
   * @param {string} symptomLabel - The display name of the symptom (e.g. "Bloating", "Cramps")
   * @param {number} [severity] - Optional severity 0–3 (None, Mild, Moderate, Severe)
   */
  async notifySymptomCreated(
    userId: string,
    symptomLogId: string,
    symptomLabel: string,
    severity?: number
  ): Promise<void> {
    if (!this.webhookUrl) {
      console.log("Slack webhook URL not configured, skipping symptom notification");
      return;
    }

    try {
      let userEmail = "Unknown user";
      try {
        const userRecord = await admin.auth().getUser(userId);
        userEmail = userRecord.email || "Unknown user";
      } catch (error) {
        console.log("Could not fetch user info for Slack notification:", error);
      }

      const severityLabels = ["None", "Mild", "Moderate", "Severe"];
      const severityText =
        severity != null ? severityLabels[severity] ?? `Level ${severity}` : "—";
      const body = `*New symptom logged!* 📋\n\n*User:* ${userEmail}\n*User ID:* \`${userId}\`\n*Symptom:* ${symptomLabel}\n*Severity:* ${severityText}\n*Record ID:* \`${symptomLogId}\`\n*Time:* ${new Date().toLocaleString()}`;
      const message = {
        text: this.prefix("📋 New symptom logged!"),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: this.prefix(body),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: isEmulator() ? "GutSpy App Activity (emulator)" : "GutSpy App Activity",
              },
            ],
          },
        ],
      };

      await this.sendToSlack(message);
    } catch (error) {
      console.error("Failed to send symptom notification to Slack:", error);
    }
  }

  /**
   * Sends a notification to Slack when a new user is created
   * @param {string} userEmail - The email of the new user
   * @param {string} userId - The user ID
   * @param {string} displayName - The display name of the user (optional)
   */
  async notifyUserCreated(userEmail: string, userId: string, displayName?: string): Promise<void> {
    if (!this.webhookUrl) {
      console.log("Slack webhook URL not configured, skipping user creation notification");
      return;
    }

    try {
      const body = `*New user signed up!* 🎉\n\n*Email:* ${userEmail}\n*User ID:* \`${userId}\`${displayName ? `\n*Name:* ${displayName}` : ""}\n*Time:* ${new Date().toLocaleString()}`;
      const message = {
        text: this.prefix("🎉 New user signed up!"),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: this.prefix(body),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: isEmulator() ? "GutSpy App Activity (emulator)" : "GutSpy App Activity",
              },
            ],
          },
        ],
      };

      await this.sendToSlack(message);
    } catch (error) {
      console.error("Failed to send user creation notification to Slack:", error);
    }
  }

  /**
   * Sends a message to Slack using the webhook
   * @param {Object} message - The message object to send
   */
  private async sendToSlack(message: any): Promise<void> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`Slack API responded with status: ${response.status}`);
      }

      console.log("Slack notification sent successfully");
    } catch (error) {
      console.error("Error sending to Slack:", error);
      throw error;
    }
  }
}
