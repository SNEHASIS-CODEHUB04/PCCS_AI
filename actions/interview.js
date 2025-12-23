"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/* ================================
   GENERATE QUIZ (UNIQUE EVERY TIME)
================================ */
export async function generateQuiz() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      id: true,
      industry: true,
      skills: true,
    },
  });

  if (!user) throw new Error("User not found");

  // Fetch last quiz to avoid repetition
  const lastAssessment = await db.assessment.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { questions: true },
  });

  const previousQuestions =
    lastAssessment?.questions?.map((q) => q.question).join("\n- ") ||
    "None";

  // Unique seed guarantees variation per click
  const quizSeed = Date.now();

  const prompt = `
Generate 10 UNIQUE technical interview questions for a ${user.industry} professional${
    user.skills?.length ? ` with expertise in ${user.skills.join(", ")}` : ""
}.

Quiz Seed: ${quizSeed}

Do NOT repeat or paraphrase any of the following questions:
- ${previousQuestions}

Rules:
- Vary difficulty (easy, medium, hard)
- Cover different concepts
- Avoid similar wording
- Each question must be multiple choice with exactly 4 options
- Correct answer must be one of the options

Return ONLY valid JSON in the following format (no markdown, no explanation):

{
  "questions": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": "string",
      "explanation": "string"
    }
  ]
}
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
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
      temperature: 0.6, // balanced randomness
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response from AI");

    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed.questions)) {
      throw new Error("Invalid quiz format");
    }

    return parsed.questions;
  } catch (error) {
    console.error("Error generating quiz:", error);
    throw new Error("Failed to generate quiz questions");
  }
}

/* ================================
   SAVE QUIZ RESULT
================================ */
export async function saveQuizResult(questions, answers, score) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  const questionResults = questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: answers[index],
    isCorrect: q.correctAnswer === answers[index],
    explanation: q.explanation,
  }));

  const wrongAnswers = questionResults.filter((q) => !q.isCorrect);

  let improvementTip = null;

  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map(
        (q) =>
          `Question: "${q.question}"
Correct Answer: "${q.answer}"`
      )
      .join("\n\n");

    const improvementPrompt = `
The user answered the following ${user.industry} interview questions incorrectly:

${wrongQuestionsText}

Provide ONE concise improvement tip:
- Max 2 sentences
- Encouraging tone
- Focus on what to study or practice
- Do NOT mention mistakes explicitly
`;

    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful interview coach. Provide concise improvement advice.",
          },
          {
            role: "user",
            content: improvementPrompt,
          },
        ],
        temperature: 0.4,
      });

      improvementTip =
        completion.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error("Error generating improvement tip:", error);
    }
  }

  try {
    return await db.assessment.create({
      data: {
        userId: user.id,
        quizScore: score,
        questions: questionResults,
        category: "Technical",
        improvementTip,
      },
    });
  } catch (error) {
    console.error("Error saving quiz result:", error);
    throw new Error("Failed to save quiz result");
  }
}

/* ================================
   FETCH USER ASSESSMENTS
================================ */
export async function getAssessments() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    return await db.assessment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    console.error("Error fetching assessments:", error);
    throw new Error("Failed to fetch assessments");
  }
}
