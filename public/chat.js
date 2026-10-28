/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
	{
		role: "assistant",
		content:
			"Hello! I'm an Fly AI chat app powered by flytripvisa.site. How can I help you today?",
	},
];
let isProcessing = false;

function scrollToBottom() {
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function resizeInput() {
	userInput.style.height = "auto";
	userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
}

function updateSendState() {
	sendButton.disabled = isProcessing || userInput.value.trim() === "";
}

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	resizeInput();
	updateSendState();
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();

	// Don't send empty messages
	if (message === "" || isProcessing) return;

	// The textarea is NOT disabled while processing: disabling it closes the
	// mobile keyboard and makes the whole screen flicker.
	isProcessing = true;

	// Add user message to chat
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	resizeInput();
	updateSendState();

	// Show typing indicator (space is reserved, so nothing jumps)
	typingIndicator.classList.add("visible");

	// Add message to history
	chatHistory.push({ role: "user", content: message });

	try {
		// Assistant bubble is created on the first token, not before
		let assistantTextEl = null;

		// Send request to API
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		// Handle errors
		if (!response.ok) {
			throw new Error("Failed to get response");
		}
		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";

		// Returns true when the stream is finished ([DONE])
		const handleEvents = (events) => {
			for (const data of events) {
				if (data === "[DONE]") return true;
				try {
					const jsonData = JSON.parse(data);
					// Handle both Workers AI format (response) and OpenAI format (choices[0].delta.content)
					let content = "";
					if (
						typeof jsonData.response === "string" &&
						jsonData.response.length > 0
					) {
						content = jsonData.response;
					} else if (jsonData.choices?.[0]?.delta?.content) {
						content = jsonData.choices[0].delta.content;
					}
					if (content) {
						if (!assistantTextEl) {
							assistantTextEl = addMessageToChat("assistant", "");
						}
						responseText += content;
						assistantTextEl.textContent = responseText;
						scrollToBottom();
					}
				} catch (e) {
					console.error("Error parsing SSE data as JSON:", e, data);
				}
			}
			return false;
		};

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				// Process any remaining complete events in buffer
				handleEvents(consumeSseEvents(buffer + "\n\n").events);
				break;
			}

			// Decode chunk
			buffer += decoder.decode(value, { stream: true });
			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;
			if (handleEvents(parsed.events)) break;
		}

		// Add completed response to chat history
		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
		} else {
			addMessageToChat("assistant", "No response received. Please try again.", true);
		}
	} catch (error) {
		console.error("Error:", error);
		addMessageToChat(
			"assistant",
			"Sorry, there was an error processing your request.",
			true,
		);
	} finally {
		// Hide typing indicator
		typingIndicator.classList.remove("visible");

		// Allow sending again (no focus() call: it would re-open the mobile keyboard)
		isProcessing = false;
		updateSendState();
	}
}

/**
 * Helper function to add message to chat. Returns the <p> element.
 * Uses textContent, so message text is never parsed as HTML.
 */
function addMessageToChat(role, content, isError = false) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message${isError ? " error" : ""}`;
	const textEl = document.createElement("p");
	textEl.textContent = content;
	messageEl.appendChild(textEl);
	chatMessages.appendChild(messageEl);

	scrollToBottom();
	return textEl;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;
	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines = [];
		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}
		if (dataLines.length === 0) continue;
		events.push(dataLines.join("\n"));
	}
	return { events, buffer: normalized };
}
