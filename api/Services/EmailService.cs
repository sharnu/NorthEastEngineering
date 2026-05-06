using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Nee.Api.Services;

public class EmailService(IConfiguration config, ILogger<EmailService> logger)
{
    public async Task<bool> SendAsync(
        string to,
        string subject,
        string htmlBody,
        string textBody,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(to))
        {
            logger.LogWarning("Email not sent: no recipient address configured.");
            return false;
        }

        var host = config["Email:SmtpHost"] ?? "localhost";
        var port = int.TryParse(config["Email:SmtpPort"], out var p) ? p : 1025;
        var fromAddress = config["Email:FromAddress"] ?? "noreply@nee.local";
        var fromName = config["Email:FromName"] ?? "North East Engineering";

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(fromName, fromAddress));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = htmlBody, TextBody = textBody }.ToMessageBody();

        try
        {
            using var smtp = new SmtpClient();
            await smtp.ConnectAsync(host, port, SecureSocketOptions.None, ct);
            await smtp.SendAsync(message, ct);
            await smtp.DisconnectAsync(true, ct);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send email to {To} via {Host}:{Port}", to, host, port);
            return false;
        }
    }
}
