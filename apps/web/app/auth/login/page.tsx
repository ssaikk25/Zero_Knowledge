import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import { safeInternalPath } from '@services/security/url'
import LoginClient from './login'
import { Metadata } from 'next'
import OrgNotFound from '@components/Objects/StyledElements/Error/OrgNotFound'

export async function generateMetadata(): Promise<Metadata> {
  const orgslug = await getAuthOrgSlug()

  if (!orgslug) {
    // Apex (org-less) login.
    return { title: { absolute: 'Login | zerok' }, robots: { index: false, follow: false } }
  }

  let org: any = null
  try {
    org = await getOrganizationContextInfo(orgslug, {
      revalidate: 60,
      tags: ['organizations'],
    })
  } catch {
    // Stale cookie or unknown org: fall back to generic title
  }

  return {
    title: { absolute: 'Login | zerok' },
    robots: { index: false, follow: false },
  }
}

const Login = async ({ searchParams }: { searchParams: Promise<{ next?: string }> }) => {
  const { next } = await searchParams
  // The proxy only forwards relative paths here, but validate again: this
  // value ends up in a redirect after sign-in.
  const safeNext = next ? safeInternalPath(next, '') : ''
  const orgslug = await getAuthOrgSlug()

  // No org slug → bare apex (learn.io) → generic, org-less login.
  let org: any = null
  if (orgslug) {
    try {
      org = await getOrganizationContextInfo(orgslug, {
        revalidate: 60,
        tags: ['organizations'],
      })
    } catch {
      org = null
    }
    // A stale/unresolved org must not replace the sign-in form with an error:
    // local development and single-tenancy apex both still need username login.
    if (!org) {
      org = null
    }
  }

  return (
    <div>
      <LoginClient org={org} next={safeNext || undefined}></LoginClient>
    </div>
  )
}

export default Login
