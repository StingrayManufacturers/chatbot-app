import { NextResponse } from "next/server";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = body?.messages ?? [];
    
    // Extract the most recent question from the React frontend
    const lastUserMessage = [...messages].reverse().find((m: any) => m?.role === "user")?.content;

    if (!lastUserMessage) {
      return NextResponse.json({ error: "No user message provided." }, { status: 400 });
    }

    // Pull variables from Vercel Environment (or .env.local)
    const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
    const agentId = process.env.AGENT_ID;

    if (!projectEndpoint || !agentId) {
      return NextResponse.json(
        { error: "Architect Error: Missing Endpoint or Agent ID" },
        { status: 500 }
      );
    }

    // 1. Authenticate (Uses Tenant ID, Client ID, and Secret from env)
    const project = new AIProjectClient(projectEndpoint, new DefaultAzureCredential());

    // 2. Create a secure Thread for this conversation
    const thread = await project.agents.createThread();

    // 3. Drop the user's question into the Thread
    await project.agents.createMessage(thread.id, {
      role: "user",
      content: lastUserMessage,
    });

    // 4. Trigger the Agent (Connects prompt to your uploaded txt files)
    let run = await project.agents.createRun(thread.id, {
      assistantId: agentId,
    });

    // 5. Poll the Agent until it finishes thinking
    while (run.status === "queued" || run.status === "in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // wait 1 second
      run = await project.agents.getRun(thread.id, run.id);
    }

    if (run.status !== "completed") {
      throw new Error(`Agent run failed or timed out. Status: ${run.status}`);
    }

    // 6. Fetch the completed response
    const threadMessages = await project.agents.listMessages(thread.id);
    
    // Azure returns messages in reverse order. data[0] is the newest answer.
    const latestResponse = threadMessages.data[0];
    
    let responseText = "No response generated.";
    if (latestResponse.role === "assistant" && latestResponse.content[0].type === "text") {
        responseText = latestResponse.content[0].text.value;
    }

    // 7. Send the clean text back to the React UI
    return NextResponse.json({ content: responseText });

  } catch (err: any) {
    console.error("Agent API Error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}