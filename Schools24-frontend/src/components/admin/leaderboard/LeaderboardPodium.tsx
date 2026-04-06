import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { getInitials } from "@/lib/utils"
import { Crown, Medal, Star, TrendingDown, TrendingUp, Minus, Trophy } from "lucide-react"

export interface PodiumItem {
    id: string
    rank: number
    name: string
    subtitle: string
    score: number
    scoreLabel: string
    trend: 'up' | 'down' | 'stable'
    secondaryMetric?: {
        value: number
        label: string
    }
    avatarUrl?: string
}

interface LeaderboardPodiumProps {
    items: PodiumItem[]
    type: 'student' | 'teacher'
}

export function LeaderboardPodium({ items, type }: LeaderboardPodiumProps) {
    const rank1 = items.find(i => i.rank === 1)
    const rank2 = items.find(i => i.rank === 2)
    const rank3 = items.find(i => i.rank === 3)

    const renderWinnerCard = (item: PodiumItem | undefined, position: 'first' | 'second' | 'third') => {
        if (!item) return null

        const isFirst = position === 'first'
        const isSecond = position === 'second'
        const isThird = position === 'third'

        // Platform heights for podium effect
        const platformHeight = isFirst ? 'h-24 sm:h-32' : isSecond ? 'h-20 sm:h-24' : 'h-16 sm:h-20'
        const platformColor = isFirst
            ? 'bg-gradient-to-t from-yellow-600 via-yellow-500 to-yellow-400'
            : isSecond
                ? 'bg-gradient-to-t from-slate-500 via-slate-400 to-slate-300'
                : 'bg-gradient-to-t from-orange-700 via-orange-600 to-orange-500'

        const rankLabel = isFirst ? '1st' : isSecond ? '2nd' : '3rd'
        const accentColor = isFirst ? 'text-yellow-500' : isSecond ? 'text-slate-400' : 'text-orange-500'
        const borderColor = isFirst ? 'border-yellow-400/50' : isSecond ? 'border-slate-400/50' : 'border-orange-400/50'
        const glowColor = isFirst ? 'shadow-yellow-500/20' : isSecond ? 'shadow-slate-400/10' : 'shadow-orange-500/15'

        return (
            <div className={`flex flex-col items-center ${isFirst ? 'order-2 z-10' : isSecond ? 'order-1' : 'order-3'}`}>
                {/* Winner Card - Glassmorphism */}
                <div className={`
                    relative w-32 p-3 rounded-2xl sm:w-56 sm:p-5
                    backdrop-blur-xl bg-card/80
                    border ${borderColor}
                    shadow-2xl ${glowColor}
                    ${isFirst ? 'scale-105' : ''}
                `}>
                    {/* Crown/Medal Icon */}
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2">
                        {isFirst ? (
                            <div className="relative">
                                <Crown className="h-8 w-8 text-yellow-500 drop-shadow-lg sm:h-10 sm:w-10" fill="currentColor" />
                                <div className="absolute inset-0 bg-yellow-400/50 blur-xl rounded-full -z-10" />
                            </div>
                        ) : (
                            <div className={`flex h-7 w-7 items-center justify-center rounded-full font-bold text-white shadow-lg sm:h-9 sm:w-9 ${isSecond ? 'bg-slate-500' : 'bg-orange-600'}`}>
                                {isSecond ? '2' : '3'}
                            </div>
                        )}
                    </div>

                    {/* Avatar */}
                    <div className="mb-2 mt-3 flex justify-center sm:mb-3 sm:mt-4">
                        <div className={`relative rounded-full p-1 ${isFirst ? 'bg-gradient-to-br from-yellow-400 to-yellow-600' : isSecond ? 'bg-gradient-to-br from-slate-300 to-slate-500' : 'bg-gradient-to-br from-orange-400 to-orange-600'}`}>
                            <Avatar className="h-14 w-14 border-4 border-background sm:h-20 sm:w-20">
                                <AvatarFallback className="bg-card text-sm font-bold sm:text-xl">
                                    {getInitials(item.name)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 rounded-full bg-card p-1 shadow-md">
                                {isFirst ? (
                                    <Trophy className="h-3 w-3 text-yellow-500 sm:h-4 sm:w-4" fill="currentColor" />
                                ) : (
                                    <Medal className={`h-3 w-3 sm:h-4 sm:w-4 ${accentColor}`} />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Name & Subtitle */}
                    <div className="mb-2 text-center sm:mb-3">
                        <h3 className="truncate text-sm font-bold sm:text-base">{item.name}</h3>
                        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">{item.subtitle}</p>
                    </div>

                    {/* Score */}
                    <div className="mb-2 text-center sm:mb-3">
                        <div className="flex items-center justify-center gap-1">
                            {type === 'teacher' && <Star className={`h-3 w-3 sm:h-4 sm:w-4 ${accentColor}`} fill="currentColor" />}
                            <span className={`text-lg font-black sm:text-2xl ${accentColor}`}>
                                {item.score}
                                {type === 'student' && <span className="text-xs sm:text-sm">%</span>}
                            </span>
                        </div>
                        <p className="text-[9px] uppercase text-muted-foreground sm:text-[10px]">{item.scoreLabel}</p>
                    </div>

                    {/* Metrics Row */}
                    <div className="flex flex-col justify-center gap-1 text-[10px] sm:flex-row sm:gap-3 sm:text-xs">
                        <div className="flex items-center justify-center gap-1 rounded-full bg-muted/50 px-2 py-1">
                            {item.trend === 'up' && <TrendingUp className="h-3 w-3 text-green-500" />}
                            {item.trend === 'down' && <TrendingDown className="h-3 w-3 text-red-500" />}
                            {item.trend === 'stable' && <Minus className="h-3 w-3 text-muted-foreground" />}
                            <span className={item.trend === 'up' ? 'text-green-600' : item.trend === 'down' ? 'text-red-600' : 'text-muted-foreground'}>
                                {item.trend === 'up' ? 'Up' : item.trend === 'down' ? 'Down' : 'Stable'}
                            </span>
                        </div>
                        {item.secondaryMetric && (
                            <div className="flex items-center justify-center gap-1 rounded-full bg-muted/50 px-2 py-1">
                                <span className="font-semibold">{item.secondaryMetric.value}{item.secondaryMetric.label === 'Attendance' ? '%' : ''}</span>
                                <span className="text-muted-foreground">{item.secondaryMetric.label}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Podium Platform */}
                <div className={`
                    w-28 ${platformHeight} mt-3 rounded-t-lg sm:mt-4 sm:w-48
                    ${platformColor}
                    flex items-center justify-center
                    shadow-xl
                    border-t-4 ${isFirst ? 'border-yellow-300' : isSecond ? 'border-slate-200' : 'border-orange-400'}
                `}>
                    <span className={`text-lg font-black text-white drop-shadow-lg sm:text-2xl`}>
                        {rankLabel}
                    </span>
                </div>
            </div>
        )
    }

    return (
        <div className="relative w-full overflow-hidden rounded-2xl">
            {/* Award Ceremony Stage Background - Rich Purple/Gold */}
            <div className="absolute inset-0 bg-gradient-to-b from-purple-950 via-indigo-950 to-slate-950" />

            {/* Radial Light Burst from Center */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(ellipse_at_top_center,_rgba(251,191,36,0.15)_0%,_transparent_60%)]" />

            {/* Colorful Spotlight Effects */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-48 bg-gradient-to-b from-yellow-400/30 to-transparent blur-3xl" />
            <div className="absolute top-0 left-10 w-32 h-40 bg-gradient-to-b from-pink-500/20 to-transparent blur-2xl" />
            <div className="absolute top-0 right-10 w-32 h-40 bg-gradient-to-b from-cyan-500/20 to-transparent blur-2xl" />
            <div className="absolute top-20 left-1/3 w-24 h-24 bg-purple-500/15 blur-2xl rounded-full" />
            <div className="absolute top-20 right-1/3 w-24 h-24 bg-pink-500/15 blur-2xl rounded-full" />

            {/* Confetti Particles */}
            <div className="absolute top-8 left-[10%] w-2 h-2 bg-yellow-400 rotate-45" />
            <div className="absolute top-12 left-[15%] w-1.5 h-3 bg-pink-400 rotate-12" />
            <div className="absolute top-6 left-[25%] w-2 h-2 bg-cyan-400 rotate-[60deg]" />
            <div className="absolute top-16 left-[30%] w-1 h-2.5 bg-yellow-300 -rotate-12" />
            <div className="absolute top-10 right-[10%] w-2 h-2 bg-pink-300 rotate-45" />
            <div className="absolute top-14 right-[18%] w-1.5 h-3 bg-yellow-400 rotate-[30deg]" />
            <div className="absolute top-8 right-[28%] w-2 h-2 bg-cyan-300 -rotate-45" />
            <div className="absolute top-20 right-[22%] w-1 h-2.5 bg-purple-300 rotate-12" />
            <div className="absolute top-24 left-[8%] w-1.5 h-1.5 bg-green-400 rotate-45" />
            <div className="absolute top-28 right-[8%] w-1.5 h-1.5 bg-orange-400 rotate-12" />

            {/* Decorative Stars/Sparkles - More visible */}
            <div className="absolute top-4 left-6 text-yellow-400/60">
                <Star className="w-5 h-5" fill="currentColor" />
            </div>
            <div className="absolute top-6 right-8 text-yellow-400/50">
                <Star className="w-6 h-6" fill="currentColor" />
            </div>
            <div className="absolute top-10 left-[20%] text-pink-400/40">
                <Star className="w-4 h-4" fill="currentColor" />
            </div>
            <div className="absolute top-8 right-[25%] text-cyan-400/40">
                <Star className="w-3 h-3" fill="currentColor" />
            </div>
            <div className="absolute top-20 left-4 text-yellow-300/30">
                <Star className="w-3 h-3" fill="currentColor" />
            </div>
            <div className="absolute top-16 right-6 text-pink-300/30">
                <Star className="w-4 h-4" fill="currentColor" />
            </div>

            {/* Main Content */}
            <div className="relative z-10 px-2 pb-0 pt-8 sm:px-6 sm:pt-12">
                {/* Title */}
                <div className="mb-5 text-center sm:mb-8">
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/20 px-3 py-1.5 sm:mb-3 sm:gap-2 sm:px-4 sm:py-2">
                        <Trophy className="h-4 w-4 text-yellow-400 sm:h-5 sm:w-5" fill="currentColor" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-yellow-400 sm:text-sm">Top Performers</span>
                        <Trophy className="h-4 w-4 text-yellow-400 sm:h-5 sm:w-5" fill="currentColor" />
                    </div>
                </div>

                {/* Winners */}
                <div className="flex items-end justify-center gap-1.5 sm:gap-4 md:gap-6">
                    {renderWinnerCard(rank2, 'second')}
                    {renderWinnerCard(rank1, 'first')}
                    {renderWinnerCard(rank3, 'third')}
                </div>

                {/* Stage Base */}
                <div className="relative mt-0">
                    <div className="h-4 bg-gradient-to-b from-slate-700 to-slate-800 rounded-b-2xl shadow-inner" />
                    <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-r from-transparent via-yellow-500/30 to-transparent" />
                </div>
            </div>
        </div>
    )
}
