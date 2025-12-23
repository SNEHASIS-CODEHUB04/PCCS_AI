"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function saveResume(content) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const resume = await db.resume.upsert({
      where: { userId: user.id },
      update: { content },
      create: {
        userId: user.id,
        content,
      },
    });

    revalidatePath("/resume");
    return resume;
  } catch (error) {
    console.error("Error saving resume:", error);
    throw new Error("Failed to save resume");
  }
}

export async function getResume() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  return await db.resume.findUnique({
    where: { userId: user.id },
  });
}

export async function improveWithAI({ current, type }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: { industryInsight: true },
  });

  if (!user) throw new Error("User not found");

  const prompt = `
As an expert resume writer, improve the following ${type} description for a ${user.industry} professional.

Current content:
"${current}"

Requirements:
- Use strong action verbs
- Include metrics and results where possible
- Highlight relevant technical skills
- Keep it concise but impactful
- Focus on achievements over responsibilities
- Use industry-specific keywords

Return ONLY one improved paragraph.
No explanations. No markdown.
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant", // ✅ supported & fast
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume writer. Rewrite content to be impactful and ATS-friendly.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
    });

    const improvedContent =
      completion.choices[0]?.message?.content?.trim();

    if (!improvedContent) {
      throw new Error("Empty AI response");
    }

    return improvedContent;
  } catch (error) {
    console.error("Error improving content:", error);
    throw new Error("Failed to improve content");
  }
}
