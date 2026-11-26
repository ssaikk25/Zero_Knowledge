import { Metadata } from 'next'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import StatsClient from './stats'

type PageParams = Promise<{ orgslug: string }>

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { orgslug } = await params
  let org
  try {
    org = await getOrganizationContextInfo(orgslug, {
      revalidate: 120,
      tags: ['organizations'],
    })
  } catch {
    return { title: 'Statistics | zerok', robots: { index: false, follow: false } }
  }
  return {
    title: `Statistics | ${org?.name || 'Organization'}`,
    robots: { index: false, follow: false },
  }
}

export default async function StatsPage({ params }: { params: PageParams }) {
  const { orgslug } = await params
  return <StatsClient orgslug={orgslug} />
}
