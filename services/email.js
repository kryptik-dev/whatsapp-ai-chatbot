import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

class EmailService {
    constructor() {
        this.gmail = null;
        this.isAuthenticated = false;
        this.setupGmail();
    }

    setupGmail() {
        try {
            // Check if credentials file exists
            const credentialsPath = path.join(process.cwd(), 'credentials.json');
            if (!fs.existsSync(credentialsPath)) {
                console.log('[Email] No credentials.json found. Email checking will be disabled.');
                return;
            }

            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            
            const { client_secret, client_id, redirect_uris } = credentials.installed;
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            // Check if token file exists
            const tokenPath = path.join(process.cwd(), 'token.json');
            if (fs.existsSync(tokenPath)) {
                const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                oAuth2Client.setCredentials(token);
                this.gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
                this.isAuthenticated = true;
                console.log('[Email] Gmail authenticated successfully');
            } else {
                console.log('[Email] No token.json found. Run email setup first.');
            }
        } catch (error) {
            console.error('[Email] Setup error:', error);
        }
    }

    async checkEmails(maxResults = 10) {
        if (!this.isAuthenticated || !this.gmail) {
            return 'Email service not configured. Please set up Gmail API credentials.';
        }

        try {
            console.log('[Email] Checking emails...');
            
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                maxResults: maxResults,
                labelIds: ['INBOX']
            });

            const messages = response.data.messages || [];
            if (messages.length === 0) {
                return 'No emails found in inbox.';
            }

            const emailDetails = [];
            for (const message of messages.slice(0, 5)) { // Get details for first 5 emails
                const email = await this.getEmailDetails(message.id);
                if (email) {
                    emailDetails.push(email);
                }
            }

            return this.formatEmailSummary(emailDetails);
        } catch (error) {
            console.error('[Email] Error checking emails:', error);
            return 'Error checking emails. Please try again.';
        }
    }

    async getEmailDetails(messageId) {
        try {
            const response = await this.gmail.users.messages.get({
                userId: 'me',
                id: messageId
            });

            const headers = response.data.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            
            // Check if email is unread
            const isUnread = response.data.labelIds?.includes('UNREAD') || false;

            return {
                subject,
                from: this.extractEmailAddress(from),
                date: this.formatDate(date),
                isUnread
            };
        } catch (error) {
            console.error('[Email] Error getting email details:', error);
            return null;
        }
    }

    extractEmailAddress(from) {
        // Extract email address from "Name <email@domain.com>" format
        const match = from.match(/<(.+?)>/);
        return match ? match[1] : from;
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return 'Unknown date';
        }
    }

    formatEmailSummary(emails) {
        if (emails.length === 0) {
            return 'No emails found.';
        }

        let summary = `📧 **Recent Emails (${emails.length}):**\n\n`;
        
        emails.forEach((email, index) => {
            const unreadIcon = email.isUnread ? '🔴 ' : '⚪ ';
            summary += `${index + 1}. ${unreadIcon}**${email.subject}**\n`;
            summary += `   From: ${email.from}\n`;
            summary += `   Date: ${email.date}\n\n`;
        });

        return summary;
    }

    async searchEmails(query, maxResults = 5) {
        if (!this.isAuthenticated || !this.gmail) {
            return 'Email service not configured.';
        }

        try {
            console.log(`[Email] Searching emails for: ${query}`);
            
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: maxResults
            });

            const messages = response.data.messages || [];
            if (messages.length === 0) {
                return `No emails found matching "${query}".`;
            }

            const emailDetails = [];
            for (const message of messages) {
                const email = await this.getEmailDetails(message.id);
                if (email) {
                    emailDetails.push(email);
                }
            }

            return this.formatEmailSummary(emailDetails);
        } catch (error) {
            console.error('[Email] Error searching emails:', error);
            return 'Error searching emails.';
        }
    }
}

export const emailService = new EmailService();
