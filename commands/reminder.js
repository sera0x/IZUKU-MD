const { cmd } = require('../lib');
const schedule = require('node-schedule');

// Initialize an object to store scheduled reminders
const reminders = {};

// Command to set a reminder change as you like😪
cmd({
    pattern: "reminder",
    desc: "Set a reminder for a task or event.",
    category: "utility",
}, async (Void, citel, text) => {
    const reminderText = text.match[1]; // Get the reminder text from the command.
    const userId = citel.sender;

    // Schedule the reminder for 5 minutes from the current time
    const reminderTime = new Date();
    reminderTime.setMinutes(reminderTime.getMinutes() + 5);

    // Store the scheduled reminder
    reminders[userId] = {
        text: reminderText,
        time: reminderTime,
    };

    // Reply to confirm the reminder
    await citel.reply(`Reminder set: "${reminderText}" for 5 minutes from now.`);

    // Schedule a job to send the reminder
    schedule.scheduleJob(reminderTime, async () => {
        const scheduledReminder = reminders[userId];
        if (scheduledReminder) {
            await citel.reply(`Reminder: "${scheduledReminder.text}"`);
            delete reminders[userId]; // Remove the reminder after it's sent
        }
    });
});
