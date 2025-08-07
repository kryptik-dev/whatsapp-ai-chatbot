import cron from 'node-cron';
import { db } from '../services/db.js';
import { googleSearch, googleSearchMultiple } from '../web_search.js';
import { gemini } from '../services/gemini.js';

class Reminders {
    constructor() {
        this.scheduledReminders = new Map();
        this.whatsappClient = null; // Will be set by the main app
        this.setupDailyCheckin();
    }

    setWhatsAppClient(client) {
        this.whatsappClient = client;
    }

    setupDailyCheckin() {
        // Schedule daily check-in at 6:30 AM South African time (UTC+2)
        // Cron format: minute hour day month day-of-week
        // 30 6 * * * = 6:30 AM every day
        cron.schedule('30 6 * * *', async () => {
            console.log('[Reminders] Running daily morning check-in');
            await this.sendDailyCheckin();
        }, {
            timezone: 'Africa/Johannesburg' // South African timezone
        });
        
        console.log('[Reminders] Daily check-in scheduled for 6:30 AM SA time');
    }

    async sendDailyCheckin() {
        try {
            if (!this.whatsappClient) {
                console.log('[Reminders] WhatsApp client not available for daily check-in');
                return;
            }

            // Get weather for Durban
            const weatherInfo = await this.getDurbanWeather();
            
            // Get incomplete tasks for all users
            const allTasks = await db.getAllIncompleteTasks();
            
            // Group tasks by phone number
            const tasksByUser = {};
            allTasks.forEach(task => {
                if (!tasksByUser[task.phoneNumber]) {
                    tasksByUser[task.phoneNumber] = [];
                }
                tasksByUser[task.phoneNumber].push(task);
            });

            // Send check-in to each user with tasks
            for (const [phoneNumber, tasks] of Object.entries(tasksByUser)) {
                await this.sendUserCheckin(phoneNumber, tasks, weatherInfo);
            }

            // Also send to Amaan (27766934588) if he has no tasks
            const amaansNumber = '27766934588';
            if (!tasksByUser[amaansNumber]) {
                await this.sendUserCheckin(amaansNumber, [], weatherInfo);
            }

        } catch (error) {
            console.error('[Reminders] Error in daily check-in:', error);
        }
    }

    async sendUserCheckin(phoneNumber, tasks, weatherInfo) {
        try {
            const chatId = `${phoneNumber}@c.us`;
            
            // Prepare task information for Gemini
            let taskInfo = '';
            if (tasks.length > 0) {
                taskInfo = `The user has ${tasks.length} incomplete tasks:\n`;
                tasks.forEach((task, index) => {
                    taskInfo += `${index + 1}. ${task.title}`;
                    if (task.dueDate) {
                        const dueDate = new Date(task.dueDate);
                        const today = new Date();
                        const diffTime = dueDate.getTime() - today.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        
                        if (diffDays < 0) {
                            taskInfo += ` (OVERDUE by ${Math.abs(diffDays)} days)`;
                        } else if (diffDays === 0) {
                            taskInfo += ` (Due today!)`;
                        } else if (diffDays === 1) {
                            taskInfo += ` (Due tomorrow)`;
                        } else {
                            taskInfo += ` (Due in ${diffDays} days)`;
                        }
                    }
                    taskInfo += '\n';
                });
            } else {
                taskInfo = 'The user has no incomplete tasks - they are all caught up!';
            }
            
            // Generate personalized daily check-in message using Gemini
            const checkinPrompt = `It's morning and I'm sending a daily check-in to the user. 

Task status: ${taskInfo}

Weather in Durban: ${weatherInfo}

Generate a friendly, encouraging morning message as Miles. Include the task information and weather naturally in the conversation. Be casual, supportive, and motivating. Keep it conversational and not too long.`;

            const message = await gemini.getReply(checkinPrompt);
            
            await this.whatsappClient.sendMessage(chatId, message);
            console.log(`[Reminders] Sent personalized daily check-in to ${phoneNumber}`);
            
        } catch (error) {
            console.error(`[Reminders] Failed to send check-in to ${phoneNumber}:`, error);
        }
    }

    async getDurbanWeather() {
        try {
            console.log('[Reminders] Fetching Durban weather...');
            
            const searchQuery = 'weather Durban South Africa';
            const weatherResults = await googleSearch(searchQuery);
            
            if (weatherResults && weatherResults.trim().length > 10) {
                // Extract key weather information
                const weatherInfo = weatherResults
                    .split('\n')
                    .slice(0, 5) // Take first 5 lines
                    .join('\n')
                    .trim();
                
                return weatherInfo;
            }
            
            return 'Weather information unavailable';
            
        } catch (error) {
            console.error('[Reminders] Error fetching weather:', error);
            return 'Weather information unavailable';
        }
    }

    async scheduleReminder(phoneNumber, taskId, dueDate, taskTitle) {
        try {
            // Parse the due date
            const reminderDate = new Date(dueDate);
            const now = new Date();
            
            // If the date is in the past, don't schedule
            if (reminderDate <= now) {
                console.log(`[Reminders] Due date ${dueDate} is in the past, not scheduling reminder`);
                return;
            }

            // Calculate delay in milliseconds
            const delay = reminderDate.getTime() - now.getTime();
            
            // Schedule the reminder
            const timeoutId = setTimeout(async () => {
                await this.sendReminder(phoneNumber, taskTitle);
                await db.completeTask(taskId); // Mark as completed after reminder
            }, delay);

            // Store the timeout ID for potential cancellation
            this.scheduledReminders.set(`${phoneNumber}-${taskId}`, timeoutId);
            
            console.log(`[Reminders] Scheduled reminder for task "${taskTitle}" on ${dueDate}`);

        } catch (error) {
            console.error('[Reminders] Error scheduling reminder:', error);
        }
    }

    async sendReminder(phoneNumber, taskTitle) {
        try {
            console.log(`[Reminders] Sending reminder to ${phoneNumber}: "${taskTitle}" is due!`);
            
            if (this.whatsappClient) {
                const chatId = `${phoneNumber}@c.us`;
                
                // Generate personalized reminder message using Gemini
                const reminderPrompt = `The user has a task due: "${taskTitle}". Generate a friendly, casual reminder message as Miles. Be encouraging and helpful, not robotic. Keep it short and conversational.`;
                const message = await gemini.getReply(reminderPrompt);
                
                try {
                    await this.whatsappClient.sendMessage(chatId, message);
                    console.log(`[Reminders] Successfully sent personalized reminder to ${phoneNumber}`);
                } catch (sendError) {
                    console.error(`[Reminders] Failed to send reminder to ${phoneNumber}:`, sendError);
                }
            } else {
                console.log('[Reminders] WhatsApp client not available, cannot send reminder');
            }
            
        } catch (error) {
            console.error('[Reminders] Error sending reminder:', error);
        }
    }

    cancelReminder(phoneNumber, taskId) {
        const key = `${phoneNumber}-${taskId}`;
        const timeoutId = this.scheduledReminders.get(key);
        
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.scheduledReminders.delete(key);
            console.log(`[Reminders] Cancelled reminder for task ${taskId}`);
        }
    }

    // Load existing reminders from database on startup
    async loadExistingReminders() {
        try {
            const pendingTasks = await db.getPendingTasks();
            
            for (const task of pendingTasks) {
                if (task.dueDate) {
                    await this.scheduleReminder(task.phoneNumber, task.id, task.dueDate, task.title);
                }
            }
            
            console.log(`[Reminders] Loaded ${pendingTasks.length} existing reminders`);
            
        } catch (error) {
            console.error('[Reminders] Error loading existing reminders:', error);
        }
    }

    async scheduleTimeReminder(phoneNumber, taskId, timeExpression, taskTitle) {
        try {
            console.log(`[Reminders] Scheduling time reminder: ${timeExpression} for task "${taskTitle}"`);
            
            // Parse time expression
            const delay = this.parseTimeExpression(timeExpression);
            
            if (delay === null) {
                console.log(`[Reminders] Could not parse time expression: ${timeExpression}`);
                return;
            }
            
            // Schedule the reminder
            const timeoutId = setTimeout(async () => {
                await this.sendReminder(phoneNumber, taskTitle);
                await db.completeTask(taskId); // Mark as completed after reminder
            }, delay);

            // Store the timeout ID for potential cancellation
            this.scheduledReminders.set(`${phoneNumber}-${taskId}`, timeoutId);
            
            console.log(`[Reminders] Scheduled reminder for task "${taskTitle}" in ${timeExpression} (${delay}ms)`);

        } catch (error) {
            console.error('[Reminders] Error scheduling time reminder:', error);
        }
    }

    parseTimeExpression(timeExpression) {
        const lowerExpression = timeExpression.toLowerCase();
        
        // Comprehensive time unit patterns
        const timePatterns = [
            // Minutes: min, mins, minute, minutes, m
            { pattern: /in\s+(\d+)\s+(minutes?|mins?|min|m)\b/, multiplier: 60 * 1000 },
            
            // Hours: hour, hours, hr, hrs, h
            { pattern: /in\s+(\d+)\s+(hours?|hrs?|hr|h)\b/, multiplier: 60 * 60 * 1000 },
            
            // Days: day, days, d
            { pattern: /in\s+(\d+)\s+(days?|d)\b/, multiplier: 24 * 60 * 60 * 1000 },
            
            // Seconds: second, seconds, sec, secs, s
            { pattern: /in\s+(\d+)\s+(seconds?|secs?|sec|s)\b/, multiplier: 1000 },
            
            // Weeks: week, weeks, w
            { pattern: /in\s+(\d+)\s+(weeks?|w)\b/, multiplier: 7 * 24 * 60 * 60 * 1000 },
            
            // Months: month, months, mo, mos
            { pattern: /in\s+(\d+)\s+(months?|mo|mos)\b/, multiplier: 30 * 24 * 60 * 60 * 1000 },
            
            // Years: year, years, yr, yrs, y
            { pattern: /in\s+(\d+)\s+(years?|yrs?|yr|y)\b/, multiplier: 365 * 24 * 60 * 60 * 1000 }
        ];
        
        // Try each pattern
        for (const { pattern, multiplier } of timePatterns) {
            const match = lowerExpression.match(pattern);
            if (match) {
                const value = parseInt(match[1]);
                return value * multiplier;
            }
        }
        
        // Parse "tomorrow at X" or "today at X"
        const tomorrowMatch = lowerExpression.match(/tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (tomorrowMatch) {
            let hour = parseInt(tomorrowMatch[1]);
            const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
            const ampm = tomorrowMatch[3] ? tomorrowMatch[3].toLowerCase() : null;
            
            // Convert to 24-hour format
            if (ampm === 'pm' && hour !== 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(hour, minute, 0, 0);
            
            return tomorrow.getTime() - Date.now();
        }
        
        // Parse "today at X"
        const todayMatch = lowerExpression.match(/today\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (todayMatch) {
            let hour = parseInt(todayMatch[1]);
            const minute = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
            const ampm = todayMatch[3] ? todayMatch[3].toLowerCase() : null;
            
            // Convert to 24-hour format
            if (ampm === 'pm' && hour !== 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            
            const today = new Date();
            today.setHours(hour, minute, 0, 0);
            
            // If the time has already passed today, schedule for tomorrow
            if (today.getTime() <= Date.now()) {
                today.setDate(today.getDate() + 1);
            }
            
            return today.getTime() - Date.now();
        }
        
        return null; // Could not parse
    }
}

export const reminders = new Reminders();
