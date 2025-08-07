import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Add a new task
export async function addTask(userId, title, description = null, dueDate = null, priority = 'medium') {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .insert([
                {
                    user_id: userId,
                    title: title,
                    description: description,
                    due_date: dueDate,
                    priority: priority
                }
            ])
            .select();

        if (error) {
            console.error('Error adding task:', error);
            throw error;
        }

        return data[0];
    } catch (error) {
        console.error('Error adding task:', error);
        throw error;
    }
}

// Get all tasks for a user
export async function getTasks(userId, includeCompleted = false) {
    try {
        const { data, error } = await supabase
            .rpc('get_tasks_for_user', {
                user_id_param: userId,
                include_completed: includeCompleted
            });

        if (error) {
            console.error('Error getting tasks:', error);
            throw error;
        }

        return data || [];
    } catch (error) {
        console.error('Error getting tasks:', error);
        throw error;
    }
}

// Get overdue tasks for a user
export async function getOverdueTasks(userId) {
    try {
        const { data, error } = await supabase
            .rpc('get_overdue_tasks_for_user', {
                user_id_param: userId
            });

        if (error) {
            console.error('Error getting overdue tasks:', error);
            throw error;
        }

        return data || [];
    } catch (error) {
        console.error('Error getting overdue tasks:', error);
        throw error;
    }
}

// Mark a task as completed
export async function completeTask(taskId, userId) {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .update({ 
                completed: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', taskId)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Error completing task:', error);
            throw error;
        }

        return data[0];
    } catch (error) {
        console.error('Error completing task:', error);
        throw error;
    }
}

// Update a task
export async function updateTask(taskId, userId, updates) {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .update({ 
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', taskId)
            .eq('user_id', userId)
            .select();

        if (error) {
            console.error('Error updating task:', error);
            throw error;
        }

        return data[0];
    } catch (error) {
        console.error('Error updating task:', error);
        throw error;
    }
}

// Delete a task
export async function deleteTask(taskId, userId) {
    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', taskId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error deleting task:', error);
            throw error;
        }

        return true;
    } catch (error) {
        console.error('Error deleting task:', error);
        throw error;
    }
}

// Get task summary for a user
export async function getTaskSummary(userId) {
    try {
        const [allTasks, overdueTasks] = await Promise.all([
            getTasks(userId, false), // Active tasks only
            getOverdueTasks(userId)
        ]);

        const totalTasks = allTasks.length;
        const overdueCount = overdueTasks.length;
        const highPriorityTasks = allTasks.filter(task => task.priority === 'high' && !task.completed);
        const dueToday = allTasks.filter(task => {
            if (!task.due_date) return false;
            const today = new Date();
            const dueDate = new Date(task.due_date);
            return dueDate.toDateString() === today.toDateString();
        });

        return {
            total: totalTasks,
            overdue: overdueCount,
            highPriority: highPriorityTasks.length,
            dueToday: dueToday.length,
            overdueTasks: overdueTasks,
            highPriorityTasks: highPriorityTasks,
            dueTodayTasks: dueToday
        };
    } catch (error) {
        console.error('Error getting task summary:', error);
        throw error;
    }
}
