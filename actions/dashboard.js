"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const generateAIInsights = async (industry) => {
  const prompt = `
Analyze the current state of the ${industry} industry and return ONLY valid JSON.
No markdown. No explanations.

{
  "salaryRanges": [
    { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
  ],
  "growthRate": number,
  "demandLevel": "High" | "Medium" | "Low",
  "topSkills": ["skill1", "skill2"],
  "marketOutlook": "Positive" | "Neutral" | "Negative",
  "keyTrends": ["trend1", "trend2"],
  "recommendedSkills": ["skill1", "skill2"]
}

Rules:
- At least 5 roles
- Growth rate must be a percentage
- At least 5 skills and trends
`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant", // ✅ SUPPORTED
    messages: [
      {
        role: "system",
        content: "You are a strict JSON API. Output ONLY valid JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
  });

  const text = completion.choices[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("Empty response from LLM");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("Invalid JSON from Groq:", text);
    throw new Error("AI returned invalid JSON");
  }
};

export async function getIndustryInsights() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: { industryInsight: true },
  });

  if (!user) throw new Error("User not found");

  if (!user.industryInsight) {
    const insights = await generateAIInsights(user.industry);

    return await db.industryInsight.create({
      data: {
        industry: user.industry,
        ...insights,
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  return user.industryInsight;
}
