import { ScheduledEvent, ScheduleFunction } from "firebase-functions/v2/scheduler";
import { generateWeeklySummaries } from "./index";

/**
 * Manually triggers the weekly summary generation for testing purposes
 * @return {Promise<void>} A promise that resolves when the summary is generated
 */
export async function triggerWeeklySummary() {
  try {
    // Create a mock scheduled event
    const mockEvent: ScheduledEvent = {
      scheduleTime: new Date().toISOString(),
    };

    await (generateWeeklySummaries as ScheduleFunction).run(mockEvent);
    console.log("Weekly summary generation completed successfully");
  } catch (error) {
    console.error("Error generating weekly summary:", error);
  }
}

// Only run if this file is being executed directly
if (require.main === module) {
  triggerWeeklySummary().catch(console.error);
}
