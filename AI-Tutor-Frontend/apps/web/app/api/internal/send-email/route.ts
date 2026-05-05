import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    // 1. Authenticate the request
    const authHeader = request.headers.get('x-internal-secret');
    const expectedSecret = process.env.AI_TUTOR_INTERNAL_SECRET || 'uc-school-internal-fallback-secret-2026';
    
    if (!authHeader || authHeader !== expectedSecret) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // 2. Parse payload
    const body = await request.json();
    const { to_email, subject, html, text_fallback, from_email } = body;

    if (!to_email || !subject || !html) {
      return new NextResponse('Missing required fields', { status: 400 });
    }

    // 3. Configure Nodemailer using existing SMTP environment variables
    const smtpHost = process.env.AI_TUTOR_SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.AI_TUTOR_SMTP_PORT || '465', 10);
    const smtpUser = process.env.AI_TUTOR_SMTP_USER;
    const smtpPassword = process.env.AI_TUTOR_SMTP_PASSWORD;
    const fromEmail = from_email || process.env.AI_TUTOR_SMTP_FROM_EMAIL || smtpUser;

    if (!smtpUser || !smtpPassword) {
      console.error("Missing SMTP credentials in environment variables");
      return new NextResponse('Server configuration error: Missing credentials', { status: 500 });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for 587
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });

    // 4. Send email
    const info = await transporter.sendMail({
      from: fromEmail,
      to: to_email,
      subject: subject,
      text: text_fallback || '',
      html: html,
    });

    console.log('Webhook email sent successfully: %s', info.messageId);
    
    return NextResponse.json({ ok: true, messageId: info.messageId });

  } catch (error: any) {
    console.error('Failed to send email via webhook:', error);
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}
