import { db } from '../services/db.js';
import { reminders } from './reminders.js';
import { gemini } from '../services/gemini.js';

class TaskManager {
    async process(message, client) {
        const userMsg = message.body.toLowerCase();
        const phoneNumber = message.from.split('@')[0];

        // Check if user is asking about their tasks
        if (userMsg.includes('what') && (userMsg.includes('today') || userMsg.includes('need to do') || userMsg.includes('tasks'))) {
            await this.listTasks(phoneNumber, client);
            return;
        }

        // Check if user is completing a task
        if (userMsg.includes('done') || userMsg.includes('completed') || userMsg.includes('finished')) {
            await this.completeTask(message, client);
            return;
        }

        // Otherwise, treat as adding a new task
        await this.addTask(message, client);
    }

    async addTask(message, client) {
        const phoneNumber = message.from.split('@')[0];
        const taskText = message.body;

        try {
            // Extract task details using Gemini with enhanced time parsing
            const taskPrompt = `Extract task information from this message: "${taskText}"
            
            Return a JSON object with:
            - title: short task title
            - description: full task description
            - dueDate: date if mentioned (YYYY-MM-DD format, null if not mentioned)
            - reminderTime: time expression if mentioned (e.g., "in 5 minutes", "in 2 hours", "tomorrow at 3pm", null if not mentioned)
            - priority: "high", "medium", or "low" based on urgency
            - category: "work", "personal", "school", "health", or "other"
            
                        Examples:
            - "remind me to call mom in 5 minutes" → {"title": "Call mom", "description": "Call mom", "dueDate": null, "reminderTime": "in 5 minutes", "priority": "medium", "category": "personal"}
            - "remind me to call mom in 5 mins" → {"title": "Call mom", "description": "Call mom", "dueDate": null, "reminderTime": "in 5 mins", "priority": "medium", "category": "personal"}
            - "remind me to call mom in 5 min" → {"title": "Call mom", "description": "Call mom", "dueDate": null, "reminderTime": "in 5 min", "priority": "medium", "category": "personal"}
            - "remind me to call mom in 5 m" → {"title": "Call mom", "description": "Call mom", "dueDate": null, "reminderTime": "in 5 m", "priority": "medium", "category": "personal"}
            - "remind me to take medicine in 2 hours" → {"title": "Take medicine", "description": "remind me to take medicine in 2 hours", "dueDate": null, "reminderTime": "in 2 hours", "priority": "high", "category": "health"}
            - "remind me to take medicine in 2 hrs" → {"title": "Take medicine", "description": "remind me to take medicine in 2 hrs", "dueDate": null, "reminderTime": "in 2 hrs", "priority": "high", "category": "health"}
            - "remind me to take medicine in 2 h" → {"title": "Take medicine", "description": "remind me to take medicine in 2 h", "dueDate": null, "reminderTime": "in 2 h", "priority": "high", "category": "health"}
            - "remind me to check oven in 30 seconds" → {"title": "Check oven", "description": "remind me to check oven in 30 seconds", "dueDate": null, "reminderTime": "in 30 seconds", "priority": "medium", "category": "other"}
            - "remind me to check oven in 30 secs" → {"title": "Check oven", "description": "remind me to check oven in 30 secs", "dueDate": null, "reminderTime": "in 30 secs", "priority": "medium", "category": "other"}
            - "remind me to check oven in 30 s" → {"title": "Check oven", "description": "remind me to check oven in 30 s", "dueDate": null, "reminderTime": "in 30 s", "priority": "medium", "category": "other"}
            - "homework due Friday" → {"title": "Homework", "description": "homework due Friday", "dueDate": "2024-01-15", "reminderTime": null, "priority": "medium", "category": "school"}`;

            const taskData = await gemini.getStructuredResponse(taskPrompt);
            
            // Add to database
            const task = await db.addTask(phoneNumber, taskData);
            
            // Set reminder if due date or reminder time is mentioned
            if (taskData.dueDate) {
                await reminders.scheduleReminder(phoneNumber, task.id, taskData.dueDate, taskData.title);
            } else if (taskData.reminderTime) {
                await reminders.scheduleTimeReminder(phoneNumber, task.id, taskData.reminderTime, taskData.title);
            }

            // Generate personalized confirmation using Gemini
            const confirmationPrompt = `The user just asked me to add a task. Generate a friendly, casual response confirming I've added their task.

Task details:
- Title: "${taskData.title}"
- Description: "${taskData.description}"
- Category: ${taskData.category}
- Priority: ${taskData.priority}
${taskData.dueDate ? `- Due Date: ${taskData.dueDate}` : ''}
${taskData.reminderTime ? `- Reminder: ${taskData.reminderTime}` : ''}

Respond naturally as Miles - friendly, casual, and helpful. Keep it short and conversational. Don't be robotic or formal.`;

            const response = await gemini.getReply(confirmationPrompt);
            await client.sendMessage(message.from, response);

        } catch (error) {
            console.error('Error adding task:', error);
            const errorPrompt = `Something went wrong while trying to add the user's task. Generate a friendly, apologetic response as Miles asking them to try again.`;
            const response = await gemini.getReply(errorPrompt);
            await client.sendMessage(message.from, response);
        }
    }

    async listTasks(phoneNumber, client) {
        try {
            const tasks = await db.getTasks(phoneNumber);
            
            if (tasks.length === 0) {
                const emptyPrompt = `The user asked about their tasks, but they have no tasks on their list. Generate a friendly, encouraging response as Miles.`;
                const response = await gemini.getReply(emptyPrompt);
                await client.sendMessage(phoneNumber + '@c.us', response);
                return;
            }

            // Generate personalized task list response
            const taskList = tasks.map((task, index) => {
                let taskInfo = `${index + 1}. ${task.title}`;
                if (task.dueDate) {
                    taskInfo += ` (due ${task.dueDate})`;
                }
                if (task.priority === 'high') {
                    taskInfo += ` 🔴`;
                } else if (task.priority === 'medium') {
                    taskInfo += ` 🟡`;
                } else {
                    taskInfo += ` 🟢`;
                }
                return taskInfo;
            }).join('\n');

            const listPrompt = `The user asked about their tasks. Here's their current task list:

${taskList}

Generate a friendly, casual response as Miles presenting their tasks. Be encouraging and helpful. Keep it conversational.`;

            const response = await gemini.getReply(listPrompt);
            await client.sendMessage(phoneNumber + '@c.us', response);

        } catch (error) {
            console.error('Error listing tasks:', error);
            const errorPrompt = `Something went wrong while trying to get the user's tasks. Generate a friendly, apologetic response as Miles.`;
            const response = await gemini.getReply(errorPrompt);
            await client.sendMessage(phoneNumber + '@c.us', response);
        }
    }

    async completeTask(message, client) {
        const phoneNumber = message.from.split('@')[0];
        const taskText = message.body;

        try {
            // Find the task to complete
            const tasks = await db.getTasks(phoneNumber);
            const taskToComplete = tasks.find(task => 
                taskText.toLowerCase().includes(task.title.toLowerCase())
            );

            if (taskToComplete) {
                await db.completeTask(taskToComplete.id);
                const completionPrompt = `The user just completed a task: "${taskToComplete.title}". Generate a friendly, encouraging response as Miles celebrating their accomplishment. Be casual and supportive.`;
                const response = await gemini.getReply(completionPrompt);
                await client.sendMessage(message.from, response);
            } else {
                const notFoundPrompt = `The user tried to complete a task but I couldn't find it in their list. Generate a friendly, helpful response as Miles asking them to be more specific about which task they want to complete.`;
                const response = await gemini.getReply(notFoundPrompt);
                await client.sendMessage(message.from, response);
            }

        } catch (error) {
            console.error('Error completing task:', error);
            const errorPrompt = `Something went wrong while trying to complete the user's task. Generate a friendly, apologetic response as Miles.`;
            const response = await gemini.getReply(errorPrompt);
            await client.sendMessage(message.from, response);
        }
    }

    async importSchoolSchedule(message, client) {
        const phoneNumber = message.from.split('@')[0];
        const scheduleText = message.body;

        try {
            // Extract multiple tasks from school schedule
            const schedulePrompt = `Extract all tasks and deadlines from this school schedule: "${scheduleText}"

Return a JSON array of task objects, each with:
- title: short task title
- description: full task description
- dueDate: date if mentioned (YYYY-MM-DD format, null if not mentioned)
- priority: "high", "medium", or "low" based on urgency
- category: "school"

Example output:
[
  {"title": "Math test", "description": "Math test on Friday", "dueDate": "2024-01-15", "priority": "high", "category": "school"},
  {"title": "Physics project", "description": "Physics project due Monday", "dueDate": "2024-01-18", "priority": "medium", "category": "school"}
]`;

            const tasksData = await gemini.getStructuredResponse(schedulePrompt);
            
            if (Array.isArray(tasksData)) {
                let addedCount = 0;
                for (const taskData of tasksData) {
                    try {
                        await db.addTask(phoneNumber, taskData);
                        addedCount++;
                    } catch (error) {
                        console.error('Error adding individual task:', error);
                    }
                }

                const importPrompt = `The user just imported ${addedCount} school tasks from their schedule. Generate a friendly, encouraging response as Miles confirming the import and offering to help them stay on track.`;
                const response = await gemini.getReply(importPrompt);
                await client.sendMessage(message.from, response);
            } else {
                throw new Error('Invalid task data format');
            }

        } catch (error) {
            console.error('Error importing school schedule:', error);
            const errorPrompt = `Something went wrong while importing the school schedule. Generate a friendly, apologetic response as Miles asking them to try again.`;
            const response = await gemini.getReply(errorPrompt);
            await client.sendMessage(message.from, response);
        }
    }

    async extractTasksFromImage(imageDescription, phoneNumber, client) {
        try {
            // Extract tasks from image description
            const imagePrompt = `Extract all tasks and deadlines from this image description: "${imageDescription}"

Return a JSON array of task objects, each with:
- title: short task title
- description: full task description
- dueDate: date if mentioned (YYYY-MM-DD format, null if not mentioned)
- priority: "high", "medium", or "low" based on urgency
- category: "school" (if school-related) or "other"

Example output:
[
  {"title": "Math test", "description": "Math test on Friday", "dueDate": "2024-01-15", "priority": "high", "category": "school"},
  {"title": "Physics project", "description": "Physics project due Monday", "dueDate": "2024-01-18", "priority": "medium", "category": "school"}
]`;

            const tasksData = await gemini.getStructuredResponse(imagePrompt);
            
            if (Array.isArray(tasksData) && tasksData.length > 0) {
                let addedCount = 0;
                for (const taskData of tasksData) {
                    try {
                        await db.addTask(phoneNumber, taskData);
                        addedCount++;
                    } catch (error) {
                        console.error('Error adding individual task from image:', error);
                    }
                }

                const importPrompt = `The user just imported ${addedCount} tasks from an image. Generate a friendly, encouraging response as Miles confirming the import and offering to help them stay on track.`;
                const response = await gemini.getReply(importPrompt);
                await client.sendMessage(phoneNumber + '@c.us', response);
                
                return addedCount;
            } else {
                console.log('[TaskManager] No tasks found in image');
                return 0;
            }

        } catch (error) {
            console.error('Error extracting tasks from image:', error);
            return 0;
        }
    }
}

export const taskManager = new TaskManager();
