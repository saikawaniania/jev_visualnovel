// CLI sample: send a support-ticket-style message to Jev and print the
// structured answers (Choice, Score, Noul) asked in a single request.
//
// Usage:
//   npm run example
//   npm run example -- "some other message to evaluate"
import { choice, noul, score } from "@typesafe-ai/sdk";
import { getClient } from "./client.js";

const DEFAULT_TICKET =
  "Hi, I've been trying to connect my Stripe account for 3 days and the " +
  "integration keeps failing. I'm losing sales. Please help ASAP.";

async function main() {
  const ticket = process.argv[2] ?? DEFAULT_TICKET;
  const client = getClient();

  const response = await client.systemOne({
    state: ticket,
    questions: {
      department: choice("Which team should handle this", {
        billing: "Payment or subscription issues",
        technical: "Bugs or integration problems",
        sales: "Pricing or account questions",
      }),
      frustration: score("How frustrated the customer appears", [
        "Calm, just stating facts",
        "Frustrated but civil",
        "Very angry, strong language",
      ]),
      is_urgent: noul("The message conveys urgency or time-sensitivity"),
    },
  });

  console.log(`state: ${ticket}\n`);

  const { department, frustration, is_urgent } = response.answers;
  console.log(
    `department: ${department.choice} (confidence=${department.confidence.toFixed(2)})`,
  );
  console.log("  probabilities:", department.probabilities);

  const nearest = Math.round(frustration.score);
  const legend = frustration.legend as Record<number, unknown>;
  console.log(
    `frustration: ${legend[nearest]} (score=${frustration.score.toFixed(2)}, ` +
      `confidence=${frustration.confidence.toFixed(2)})`,
  );
  console.log("  probabilities:", frustration.probabilities);

  console.log(`is_urgent: ${is_urgent.noul.toFixed(2)}`);
  console.log("\nusage:", response.usage);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
