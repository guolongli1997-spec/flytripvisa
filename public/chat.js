/**
 * Fly AI Chat Client
 * Streams responses from /api/chat via SSE (Workers AI).
 * Maintains message history in-memory for context.
 */

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

let messageHistory = [
  {
    role: "system",
    content:
      "You are Fly AI by flytripvisa.site — a professional travel, visa, flights, and hotels assistant for GCC & Asia. Provide concise, accurate, and helpful responses.",
  },
];

// ---- Auto-resize textarea ----
function autoResize() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
}

// ---- Send button state ----
function updateSendButton() {
  sendButton.disabled = !userInput.value.trim();
}

// ---- Append a message bubble ----
function appendMessage(text, role) {
  const div = document.createElement("div");
  div.className = `message ${role}-message`;
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

// ---- Send message ----
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  // Render user message
  appendMessage(text, "user");
  messageHistory.push({ role: "user", content: text });

  // Reset input
  userInput.value = "";
  autoResize();
  updateSendButton();
  typingIndicator.classList.add("visible");

  // Placeholder for assistant reply
  const assistantDiv = document.createElement("div");
  assistantDiv.className = "message assistant-message";
  const assistantP = document.createElement("p");
  assistantP.textContent = "";
  assistantDiv.appendChild(assistantP);
  chatMessages.appendChild(assistantDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  let fullText = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ messages: messageHistory }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Workers AI SSE: parse data lines
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const token =
              parsed?.response ??
              parsed?.choices?.[0]?.delta?.content ??
              parsed?.token ??
              "";
            if (token) {
              fullText += token;
              assistantP.textContent = fullText;
              chatMessages.scrollTop = chatMessages.scrollHeight;
            }
          } catch {
            // Non-JSON line, skip
          }
        }
      }
    }

    if (fullText) {
      messageHistory.push({ role: "assistant", content: fullText });
    } else {
      assistantP.textContent = "No response received. Please try again.";
      assistantDiv.classList.add("error");
    }
  } catch (error) {
    console.error("Chat error:", error);
    assistantP.textContent = "Sorry, something went wrong. Please try again.";
    assistantDiv.classList.add("error");
  } finally {
    typingIndicator.classList.remove("visible");
  }
}

// ---- Event listeners ----
userInput.addEventListener("input", () => {
  autoResize();
  updateSendButton();
});

sendButton.addEventListener("click", sendMessage);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Initial state
updateSendButton();
