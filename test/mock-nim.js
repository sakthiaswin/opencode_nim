import http from "node:http";

// Minimal fake NIM/OpenAI-compatible endpoint for testing nim-guard locally
// without burning real API quota.
const PORT = 9999;

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    const promptTokens = Math.ceil(JSON.stringify(body.messages).length / 4);
    const completionTokens = 20;

    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk1 = {
        id: "test",
        choices: [{ delta: { content: "hello " }, index: 0 }],
      };
      const chunk2 = {
        id: "test",
        choices: [{ delta: { content: "world" }, index: 0, finish_reason: "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      };
      res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
      await new Promise((r) => setTimeout(r, 10));
      res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
      res.write(`data: [DONE]\n\n`);
      return res.end();
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "test",
        choices: [{ message: { role: "assistant", content: "mock response" }, index: 0 }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      })
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`mock NIM listening on :${PORT}`));
