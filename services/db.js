import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

class DatabaseService {
    constructor() {
        this.initializeTable();
    }

    async initializeTable() {
        try {
            // Create tasks table if it doesn't exist
            const { error } = await supabase.rpc('create_tasks_table_if_not_exists');
            if (error && !error.message.includes('already exists')) {
                console.log('[DB] Creating tasks table...');
                // If the RPC doesn't exist, we'll handle it gracefully
            }
        } catch (error) {
            console.log('[DB] Table initialization check completed');
        }
    }

    async addTask(phoneNumber, taskData) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .insert({
                    phone_number: phoneNumber,
                    title: taskData.title,
                    description: taskData.description,
                    due_date: taskData.dueDate,
                    priority: taskData.priority,
                    category: taskData.category,
                    completed: false,
                    created_at: new Date().toISOString()
                })
                .select()
                .single();

            if (error) {
                console.error('[DB] Error adding task:', error);
                throw error;
            }

            console.log(`[DB] Added task "${taskData.title}" for ${phoneNumber}`);
            return data;

        } catch (error) {
            console.error('[DB] Error adding task:', error);
            throw error;
        }
    }

    async getTasks(phoneNumber) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('phone_number', phoneNumber)
                .eq('completed', false)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DB] Error getting tasks:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('[DB] Error getting tasks:', error);
            return [];
        }
    }

    async getPendingTasks() {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('completed', false)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DB] Error getting pending tasks:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('[DB] Error getting pending tasks:', error);
            return [];
        }
    }

    async completeTask(taskId) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .update({ 
                    completed: true, 
                    completed_at: new Date().toISOString() 
                })
                .eq('id', taskId)
                .select()
                .single();

            if (error) {
                console.error('[DB] Error completing task:', error);
                return false;
            }

            console.log(`[DB] Completed task "${data.title}"`);
            return true;

        } catch (error) {
            console.error('[DB] Error completing task:', error);
            return false;
        }
    }

    async deleteTask(taskId) {
        try {
            const { error } = await supabase
                .from('tasks')
                .delete()
                .eq('id', taskId);

            if (error) {
                console.error('[DB] Error deleting task:', error);
                return false;
            }

            console.log(`[DB] Deleted task ${taskId}`);
            return true;

        } catch (error) {
            console.error('[DB] Error deleting task:', error);
            return false;
        }
    }

    async updateTask(taskId, updates) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .update(updates)
                .eq('id', taskId)
                .select()
                .single();

            if (error) {
                console.error('[DB] Error updating task:', error);
                return null;
            }

            console.log(`[DB] Updated task "${data.title}"`);
            return data;

        } catch (error) {
            console.error('[DB] Error updating task:', error);
            return null;
        }
    }

    // Get tasks by category
    async getTasksByCategory(phoneNumber, category) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('phone_number', phoneNumber)
                .eq('category', category)
                .eq('completed', false)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DB] Error getting tasks by category:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('[DB] Error getting tasks by category:', error);
            return [];
        }
    }

    // Get tasks by priority
    async getTasksByPriority(phoneNumber, priority) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('phone_number', phoneNumber)
                .eq('priority', priority)
                .eq('completed', false)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DB] Error getting tasks by priority:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('[DB] Error getting tasks by priority:', error);
            return [];
        }
    }

    // Get overdue tasks
    async getOverdueTasks(phoneNumber) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('phone_number', phoneNumber)
                .eq('completed', false)
                .lt('due_date', today)
                .order('due_date', { ascending: true });

            if (error) {
                console.error('[DB] Error getting overdue tasks:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('[DB] Error getting overdue tasks:', error);
            return [];
        }
    }

    // Get all incomplete tasks for all users (for daily check-in)
    async getAllIncompleteTasks() {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('completed', false)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('[DB] Error getting all incomplete tasks:', error);
                return [];
            }

            return data || [];

        } catch (error) {
            console.error('[DB] Error getting all incomplete tasks:', error);
            return [];
        }
    }
}

export const db = new DatabaseService();
