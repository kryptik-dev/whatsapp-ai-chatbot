# 🧠 Miles Assistant

Miles is a natural language WhatsApp assistant that responds like a human friend. No commands needed - just chat naturally!

## ✨ Features

- **Natural Conversation**: Miles responds like a real person, no commands required
- **Task Management**: Automatically detects when you mention tasks, homework, or deadlines
- **Smart Reminders**: Sets reminders for due dates and important events
- **Media Analysis**: Analyzes images, videos, and audio messages
- **Memory System**: Remembers important details about conversations
- **Discord Integration**: Full Discord bot integration for management

## 🏗️ Architecture

```
/miles-assistant
├── index.js             # Main WhatsApp + Discord bot
├── handlers/
│   ├── chatHandler.js   # Auto triggers based on message content
│   ├── taskManager.js   # Handles task logic (add/list/complete)
│   └── reminders.js     # Schedule and send reminders
├── services/
│   ├── gemini.js        # Gemini 2.5 Pro API integration
│   └── db.js            # Task storage (JSON + Supabase ready)
├── .env                 # Environment variables
└── README.md
```

## 🚀 Natural Language Examples

| You say | Miles replies |
|---------|---------------|
| "I've got a math test tomorrow" | "Got it. Should I remind you to revise tonight?" |
| "What do I need to do today?" | "You've got English homework and a meeting at 3PM." |
| "Send an email to Mr Jacobs about the project" | "Want me to draft the message for you now?" |
| "Remind me to take my meds at 6" | "Alright, I'll ping you at 6PM." |

## 🔧 Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Environment variables** (`.env`):
   ```
   DISCORD_TOKEN=your_discord_token
   GEMINI_API=your_gemini_api_key
   MAIN_CHAT_CHANNEL_ID=your_channel_id
   YOUR_USER_ID=your_user_id
   ```

3. **Run the bot**:
   ```bash
   node index.js
   ```

## 🧠 How It Works

### Message Processing Flow
1. **Natural Language Detection**: Miles automatically detects task-related keywords
2. **Smart Routing**: Task messages go to task manager, others to Gemini
3. **Context Awareness**: Uses conversation history and memory for better responses
4. **Proactive Help**: Offers reminders and suggestions based on context

### Task Management
- **Auto-detection**: Recognizes mentions of homework, tests, meetings, etc.
- **Smart Extraction**: Uses Gemini to extract task details from natural language
- **Reminder Scheduling**: Automatically sets reminders for due dates
- **Easy Completion**: Mark tasks as done with natural language

### Memory System
- **Pinned Memories**: Important facts (names, preferences, etc.)
- **Relevant Context**: Past conversations related to current topic
- **Search Capability**: Can search memory for specific information

## 🔌 API Integration

- **Gemini 2.5 Pro**: Primary AI model with Flash fallback
- **WhatsApp Web**: Real-time messaging
- **Discord**: Management interface and logging
- **Supabase**: Memory storage (optional)

## 📱 Usage

Just chat naturally with Miles on WhatsApp! No commands needed:

- Mention tasks: "I have homework due Friday"
- Ask about tasks: "What do I need to do today?"
- Complete tasks: "Finished my math homework"
- General chat: "How's your day going?"

## 🛠️ Development

### Adding New Features
1. **Handlers**: Add new handlers in `/handlers/`
2. **Services**: Add new services in `/services/`
3. **Integration**: Update `chatHandler.js` to route new message types

### Database
- **Current**: JSON file storage for tasks
- **Future**: Supabase integration for persistent storage
- **Migration**: Easy migration path between storage types

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

---

**Miles** - Your natural language assistant that feels like chatting with a friend! 🧠✨
