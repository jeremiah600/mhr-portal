// app/api/notify/route.ts
// Place this file at: app/api/notify/route.ts in your Next.js project

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const ADMIN_EMAILS = ['jbogdon@myhrpros.com', 'joseph@myhrpros.com']
const FROM = 'MHR Budget Portal <noreply@myhrpros.com>'

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifyPayload =
  | {
      type: 'submitted'
      directorName: string
      directorEmail: string
      deptName: string
      itemCount: number
      scenarioLabel: string
    }
  | {
      type: 'approved'
      directorEmail: string
      deptName: string
      itemId: string
      description: string
      amount: number
      month: string
      scenarioLabel: string
    }
  | {
      type: 'returned'
      directorEmail: string
      deptName: string
      itemId: string
      description: string
      amount: number
      month: string
      scenarioLabel: string
      returnComment: string
    }
  | {
      type: 'window_opened'
      deptName: string
      scenarioLabel: string
      openedBy: string
    }

// ─── Email templates ──────────────────────────────────────────────────────────

function submittedEmail(p: Extract<NotifyPayload, { type: 'submitted' }>) {
  const subject = `[Budget Portal] ${p.deptName} submitted ${p.itemCount} item${p.itemCount !== 1 ? 's' : ''} for approval`
  const html = `
    <p>Hi,</p>
    <p><strong>${p.directorName}</strong> (${p.directorEmail}) has submitted <strong>${p.itemCount} budget line item${p.itemCount !== 1 ? 's' : ''}</strong> for the <strong>${p.deptName}</strong> department under <strong>${p.scenarioLabel}</strong>.</p>
    <p>Please log in to the <a href="https://mhr-portal.vercel.app">MHR Budget Portal</a> to review and approve.</p>
    <hr />
    <p style="color:#888;font-size:12px;">My HR Professionals · Budget Planning Portal</p>
  `
  return { subject, html }
}

function approvedEmail(p: Extract<NotifyPayload, { type: 'approved' }>) {
  const subject = `[Budget Portal] Your item "${p.description}" was approved`
  const html = `
    <p>Hi,</p>
    <p>Your budget line item has been <strong>approved</strong> by both administrators.</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Description</td><td style="padding:4px 0;"><strong>${p.description}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Department</td><td style="padding:4px 0;">${p.deptName}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Month</td><td style="padding:4px 0;">${p.month}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Amount</td><td style="padding:4px 0;">$${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Scenario</td><td style="padding:4px 0;">${p.scenarioLabel}</td></tr>
    </table>
    <p>No further action is needed. This item is now locked in the portal.</p>
    <hr />
    <p style="color:#888;font-size:12px;">My HR Professionals · Budget Planning Portal</p>
  `
  return { subject, html }
}

function returnedEmail(p: Extract<NotifyPayload, { type: 'returned' }>) {
  const subject = `[Budget Portal] Your item "${p.description}" was returned`
  const html = `
    <p>Hi,</p>
    <p>Your budget line item has been <strong>returned</strong> for revision.</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Description</td><td style="padding:4px 0;"><strong>${p.description}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Department</td><td style="padding:4px 0;">${p.deptName}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Month</td><td style="padding:4px 0;">${p.month}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Amount</td><td style="padding:4px 0;">$${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
    </table>
    <div style="background:#fef3cd;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px;">
      <strong>Reviewer comment:</strong><br />${p.returnComment}
    </div>
    <p>Please log in to the <a href="https://mhr-portal.vercel.app">MHR Budget Portal</a>, make any necessary corrections, and re-submit.</p>
    <hr />
    <p style="color:#888;font-size:12px;">My HR Professionals · Budget Planning Portal</p>
  `
  return { subject, html }
}

function windowOpenedEmail(p: Extract<NotifyPayload, { type: 'window_opened' }>) {
  const subject = `[Budget Portal] Submission window opened — ${p.deptName}`
  const html = `
    <p>Hi,</p>
    <p>The budget submission window for <strong>${p.deptName}</strong> (${p.scenarioLabel}) has been <strong>opened</strong> by ${p.openedBy}.</p>
    <p>Directors in this department can now submit line items for approval. Log in at <a href="https://mhr-portal.vercel.app">mhr-portal.vercel.app</a>.</p>
    <hr />
    <p style="color:#888;font-size:12px;">My HR Professionals · Budget Planning Portal</p>
  `
  return { subject, html }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as NotifyPayload

    let to: string[]
    let subject: string
    let html: string

    switch (payload.type) {
      case 'submitted': {
        // Notify both admins
        to = ADMIN_EMAILS
        const tpl = submittedEmail(payload)
        subject = tpl.subject
        html = tpl.html
        break
      }

      case 'approved': {
        // Notify the director
        to = [payload.directorEmail]
        const tpl = approvedEmail(payload)
        subject = tpl.subject
        html = tpl.html
        break
      }

      case 'returned': {
        // Notify the director
        to = [payload.directorEmail]
        const tpl = returnedEmail(payload)
        subject = tpl.subject
        html = tpl.html
        break
      }

      case 'window_opened': {
        // Notify both admins (FYI log; directors aren't emailed here — they see it in the portal)
        to = ADMIN_EMAILS
        const tpl = windowOpenedEmail(payload)
        subject = tpl.subject
        html = tpl.html
        break
      }

      default:
        return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 })
    }

    const { error } = await resend.emails.send({ from: FROM, to, subject, html })

    if (error) {
      console.error('[notify] Resend error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notify] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
