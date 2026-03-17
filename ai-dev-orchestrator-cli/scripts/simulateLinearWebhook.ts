import dotenv from "dotenv";
dotenv.config();

const PORT = process.env["PORT"] ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;

async function simulateWebhook(): Promise<void> {
  console.log("=== Simulating Linear Webhook ===\n");

  const issueCreatedPayload = {
    action: "create",
    type: "Issue",
    data: {
      id: "LIN-1042",
      title: "Add request validation middleware to API endpoints",
      description: "Our API endpoints lack consistent input validation.",
    },
  };

  console.log("Sending issue.created webhook...");
  const res1 = await fetch(`${BASE_URL}/webhooks/linear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(issueCreatedPayload),
  });
  console.log(`Response: ${res1.status} ${JSON.stringify(await res1.json())}\n`);

  console.log("Sending /ai-plan command...");
  const commentPayload = {
    action: "create",
    type: "Comment",
    data: {
      id: "comment-001",
      body: "/ai-plan",
      issueId: "LIN-1042",
    },
  };
  const res2 = await fetch(`${BASE_URL}/webhooks/linear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(commentPayload),
  });
  console.log(`Response: ${res2.status} ${JSON.stringify(await res2.json())}\n`);

  console.log("Sending /approve-plan command...");
  const approvePayload = {
    action: "create",
    type: "Comment",
    data: {
      id: "comment-002",
      body: "/approve-plan",
      issueId: "LIN-1042",
    },
  };
  const res3 = await fetch(`${BASE_URL}/webhooks/linear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(approvePayload),
  });
  console.log(`Response: ${res3.status} ${JSON.stringify(await res3.json())}\n`);

  console.log("=== Webhook simulation complete ===");
}

simulateWebhook().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
