import { ChiliVote } from '@/components/chili-vote'

export const metadata = { title: 'Chili Cook-Off · StoryChurch Auction' }

export default async function ChiliPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const e = parseInt((await searchParams).e ?? '', 10) // a QR on a chili's card links straight to that chili
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4">
      <h1 className="text-4xl uppercase leading-[0.95] text-ink sm:text-5xl">Chili cook-off</h1>
      <ChiliVote highlight={Number.isInteger(e) ? e : undefined} />
    </div>
  )
}
