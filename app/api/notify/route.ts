// app/api/notify/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = new Resend(process.env.RESEND_API_KEY)

const ADMIN_EMAILS = ['jbogdon@myhrpros.com', 'joseph@myhrpros.com']
const FROM = 'MHR Budget Portal <noreply@myhrpros.com>'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getDirectorEmail(dept_code: string): Promise<string | undefined> {
  try {
    const admin = getAdminClient()
    const { data: row } = await admin
      .from('users')
      .select('user_id')
      .eq('dept_code', dept_code)
      .eq('role', 'director')
      .maybeSingle()
    if (!row?.user_id) return undefined
    const { data: { user } } = await admin.auth.admin.getUserById(row.user_id)
    return user?.email ?? undefined
  } catch {
    return undefined
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const { type } = payload

    let to: string[]
    let subject: string
    let html: string

    switch (type) {
      // submitted — two shapes:
      //   a) Batch:  { directorName, directorEmail, deptName, itemCount, scenarioLabel }
      //   b) Single: { dept, description, account_code, month, amount, submittedBy }
      case 'submitted': {
        to = ADMIN_EMAILS
        if (payload.itemCount != null) {
          const { directorName, directorEmail, deptName, itemCount, scenarioLabel } = payload
          subject = `[Budget Portal] ${deptName} submitted ${itemCount} item${itemCount !== 1 ? 's' : ''} for approval`
          html = `
            <p>Hi,</p>
            <p><strong>${directorName ?? directorEmail}</strong> has submitted <strong>${itemCount} budget item${itemCount !== 1 ? 's' : ''}</strong> from <strong>${deptName}</strong> (${scenarioLabel ?? '2027 Budget'}).</p>
            <p>Log in to the <a href="https://mhr-portal.vercel.app">MHR Budget Portal</a> to review and approve.</p>
            <hr /><p style="color:#888;font-size:12px;">My HR Professionals &middot; Budget Planning Portal</p>
          `
        } else {
          const { dept, description, account_code, month, amount, submittedBy } = payload
          subject = `[Budget Portal] ${dept} submitted a budget item for approval`
          html = `
            <p>Hi,</p>
            <p><strong>${submittedBy}</strong> submitted a budget line item from <strong>${dept}</strong> for approval.</p>
            <table style="border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:4px 12px 4px 0;color:#555;">GL Account</td><td><strong>${account_code}</strong></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#555;">Description</td><td>${description}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#555;">Month</td><td>${month}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#555;">Amount</td><td>$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
            </table>
            <p>Log in to the <a href="https://mhr-portal.vercel.app">MHR Budget Portal</a> to review and approve.</p>
            <hr /><p style="color:#888;font-size:12px;">My HR Professionals &middot; Budget Planning Portal</p>
          `
        }
        break
      }

      // approved — { dept, dept_code, description, account_code, month, amount }
      case 'approved': {
        const { dept, dept_code, description, account_code, month, amount } = payload
        subject = `[Budget Portal] Your item "${description}" was approved — ${dept}`
        html = `
          <p>Your budget line item has been <strong>fully approved</strong> by both administrators.</p>
          <table style="border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#555;">GL Account</td><td><strong>${account_code}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555;">Description</td><td>${description}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555;">Month</td><td>${month}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555;">Amount</td><td>$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
          </table>
          <p>This item is now locked in the portal.</p>
          <hr /><p style="color:#888;font-size:12px;">My HR Professionals &middot; Budget Planning Portal</p>
        `
        const directorEmail = dept_code ? await getDirectorEmail(String(dept_code)) : undefined
        to = directorEmail
          ? [...ADMIN_EMAILS, directorEmail].filter((v, i, a) => a.indexOf(v) === i)
          : ADMIN_EMAILS
        break
      }

      // returned — { dept, dept_code, description, comment }
      case 'returned': {
        const { dept, dept_code, description, comment } = payload
        subject = `[Budget Portal] Your item "${description}" was returned — ${dept}`
        html = `
          <p>Your budget line item has been <strong>returned</strong> for revision.</p>
          <table style="border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#555;">Description</td><td>${description}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555;">Department</td><td>${dept}</td></tr>
          </table>
          <div style="background:#fef3cd;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px;">
            <strong>Reviewer comment:</strong><br />${comment}
          </div>
          <p>Log in to the <a href="https://mhr-portal.vercel.app">MHR Budget Portal</a>, revise the item, and re-submit.</p>
          <hr /><p style="color:#888;font-size:12px;">My HR Professionals &middot; Budget Planning Portal</p>
        `
        const directorEmail = dept_code ? await getDirectorEmail(String(dept_code)) : undefined
        to = directorEmail
          ? [...ADMIN_EMAILS, directorEmail].filter((v, i, a) => a.indexOf(v) === i)
          : ADMIN_EMAILS
        break
      }

      // window_opened — { deptName, scenarioLabel, openedBy }
      case 'window_opened': {
        const { deptName, scenarioLabel, openedBy } = payload
        subject = `[Budget Portal] Submission window opened — ${deptName}`
        html = `
          <p>The submission window for <strong>${deptName}</strong> (${scenarioLabel ?? '2027 Budget'}) has been <strong>opened</strong> by ${openedBy}.</p>
          <p>Directors in this department can now submit line items for approval at <a href="https://mhr-portal.vercel.app">mhr-portal.vercel.app</a>.</p>
          <hr /><p style="color:#888;font-size:12px;">My HR Professionals &middot; Budget Planning Portal</p>
        `
        to = ADMIN_EMAILS
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
