import { ChiliVote } from '@/components/chili-vote'

export const metadata = { title: 'Chili Cook-Off · StoryChurch Auction' }

export default function ChiliPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-4">
      <h1 className="text-4xl uppercase leading-[0.95] text-ink sm:text-5xl">Chili cook-off</h1>
      <ChiliVote />
    </div>
  )
}
