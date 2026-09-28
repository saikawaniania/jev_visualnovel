// Minimal Express server exposing a Jev judgment to a frontend.
//
// Run: npm run dev
//
// The frontend calls POST /judge with plain text; it never sees
// TYPESAFE_API_KEY. Swap the questions below for whatever judgment your
// app actually needs.
import express from "express";
import { choice, noul, score } from "@typesafe-ai/sdk";
import { getClient } from "./client.js";

const app = express();
app.use(express.json());

app.post("/judge", async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    const client = getClient();
    const response = await client.systemOne({
      state: text,
      questions: {
        category: choice("What kind of message is this", {
          praise: "Positive feedback",
          complaint: "A problem or complaint",
          question: "Asking for information",
        }),
        intensity: score("How strong the emotion behind the message is", [
          "Neutral",
          "Mild",
          "Strong",
        ]),
        is_urgent: noul("The message needs a fast response"),
      },
    });

    const { category, intensity, is_urgent } = response.answers;
    res.json({
      category: category.choice,
      intensity: intensity.score,
      is_urgent: is_urgent.noul >= 0.5,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "jev request failed" });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Jev starter API listening on :${port}`);
});
