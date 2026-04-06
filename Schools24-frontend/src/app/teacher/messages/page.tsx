"use client"

import { FormEvent, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Search, Send, MessageSquare, Loader2, Calendar, Wifi, WifiOff, Menu, X } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { api, ValidationError } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { compareClassLabels } from '@/lib/classOrdering'
import { useTeacherMessagesWS } from '@/hooks/useTeacherMessagesWS'

interface ClassMessageGroup {
    class_id: string
    class_name: string
    grade: number
    section?: string | null
    last_message?: string
    last_message_at?: string
    last_sender_name?: string
    last_sender_role?: string
}

interface ClassGroupMessage {
    id: string
    class_id: string
    sender_id: string
    sender_name: string
    sender_role: string
    content: string
    created_at: string
}

interface ClassGroupsResponse {
    groups: ClassMessageGroup[]
}

interface ClassMessagesPage {
    messages: ClassGroupMessage[]
    page: number
    page_size: number
    has_more: boolean
    next_page: number
}

const formatClassLabel = (group: ClassMessageGroup) => {
    const name = (group.class_name || '').trim()
    const section = (group.section || '').trim()
    if (!section) return name
    const upperName = name.toUpperCase()
    const upperSection = section.toUpperCase()
    if (upperName.endsWith(`-${upperSection}`) || upperName.endsWith(` ${upperSection}`)) {
        return name
    }
    return `${name}-${section}`
}

export default function TeacherMessagesPage() {
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedClassId, setSelectedClassId] = useState('')
    const [draft, setDraft] = useState('')
    const [mobileGroupsOpen, setMobileGroupsOpen] = useState(false)

    const { data: groupsData, isLoading: groupsLoading } = useQuery({
        queryKey: ['teacher-class-message-groups'],
        queryFn: () => api.getOrEmpty<ClassGroupsResponse>('/teacher/messages/class-groups', { groups: [] }),
        staleTime: 30 * 1000,
        retry: 1,
    })

    const groups = useMemo(() => {
        const source = groupsData?.groups || []
        return [...source].sort((a, b) => compareClassLabels(formatClassLabel(a), formatClassLabel(b)))
    }, [groupsData?.groups])

    const filteredGroups = useMemo(() => {
        const term = searchQuery.trim().toLowerCase()
        if (!term) return groups
        return groups.filter((g) => {
            const classLabel = formatClassLabel(g).toLowerCase()
            const last = (g.last_message || '').toLowerCase()
            return classLabel.includes(term) || last.includes(term)
        })
    }, [groups, searchQuery])

    const effectiveSelectedClassId = selectedClassId || filteredGroups[0]?.class_id || ''

    const selectedGroup = useMemo(
        () => groups.find((group) => group.class_id === effectiveSelectedClassId) || null,
        [groups, effectiveSelectedClassId]
    )

    const {
        data: messagesData,
        isLoading: messagesLoading,
        hasNextPage,
        fetchNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['teacher-class-group-messages', effectiveSelectedClassId],
        enabled: !!effectiveSelectedClassId,
        initialPageParam: 1,
        retry: 1,
        queryFn: async ({ pageParam }) => {
            try {
                return await api.get<ClassMessagesPage>(`/teacher/messages/class-groups/${effectiveSelectedClassId}/messages?page=${pageParam}&page_size=50`)
            } catch (e) {
                if (e instanceof ValidationError) return { messages: [], page: 1, page_size: 50, has_more: false, next_page: 0 }
                throw e
            }
        },
        getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_page : undefined),
    })

    const messages = useMemo(
        () => messagesData?.pages.flatMap((page) => page.messages) || [],
        [messagesData?.pages]
    )

    const sendMutation = useMutation({
        mutationFn: (payload: { classId: string; content: string }) =>
            api.post(`/teacher/messages/class-groups/${payload.classId}/messages`, { content: payload.content }),
        onSuccess: () => {
            setDraft('')
            queryClient.invalidateQueries({ queryKey: ['teacher-class-group-messages', effectiveSelectedClassId] })
            queryClient.invalidateQueries({ queryKey: ['teacher-class-message-groups'] })
        },
        onError: (error) => {
            toast.error('Failed to send message', { description: error instanceof Error ? error.message : 'Please try again' })
        },
    })

    // Real-time WebSocket: injects new messages directly into the query cache.
    const { wsStatus } = useTeacherMessagesWS(
        effectiveSelectedClassId,
        ['teacher-class-group-messages', effectiveSelectedClassId]
    )

    const onSend = (e: FormEvent) => {
        e.preventDefault()
        if (!effectiveSelectedClassId) return
        const content = draft.trim()
        if (!content) {
            toast.error('Message cannot be empty')
            return
        }
        sendMutation.mutate({ classId: effectiveSelectedClassId, content })
    }

    const renderGroupList = () => (
        <div className="space-y-2 max-h-[40vh] xl:max-h-[560px] overflow-y-auto pr-1">
            {groupsLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading class groups...
                </div>
            ) : filteredGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 md:p-6 text-center text-muted-foreground text-sm">
                    No class groups available.
                </div>
            ) : (
                filteredGroups.map((group) => {
                    const isActive = group.class_id === effectiveSelectedClassId
                    return (
                        <button
                            key={group.class_id}
                            className={`w-full text-left p-2.5 sm:p-3 rounded-lg border transition-colors ${isActive ? 'bg-primary/10 border-primary/40' : 'hover:bg-muted'
                                }`}
                            onClick={() => {
                                setSelectedClassId(group.class_id)
                                setMobileGroupsOpen(false)
                            }}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="font-medium truncate text-sm sm:text-base">{formatClassLabel(group)}</p>
                                <Badge variant="outline" className="text-[10px] capitalize">
                                    {group.last_sender_role || 'group'}
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-1">
                                {group.last_message || 'No messages yet'}
                            </p>
                            {group.last_message_at ? (
                                <p className="text-[11px] text-muted-foreground mt-1">
                                    {new Date(group.last_message_at).toLocaleString()}
                                </p>
                            ) : null}
                        </button>
                    )
                })
            )}
        </div>
    )

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl md:text-3xl font-bold">Messages</h1>
                <p className="text-muted-foreground">Class group conversations for your assigned classes</p>
            </div>

            <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-3">
                <Card className="hidden xl:block xl:col-span-1">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg">Class Groups</CardTitle>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search class groups..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </CardHeader>
                    <CardContent>
                        {renderGroupList()}
                    </CardContent>
                </Card>

                <Card className="xl:col-span-2">
                    <CardHeader className="px-3 pt-3 pb-2 sm:px-6 sm:pt-6 sm:pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8 xl:hidden"
                                    onClick={() => setMobileGroupsOpen(true)}
                                >
                                    <Menu className="h-4 w-4" />
                                </Button>
                                <Avatar>
                                    <AvatarFallback>
                                        {selectedGroup ? getInitials(formatClassLabel(selectedGroup)) : <MessageSquare className="h-4 w-4" />}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                    <CardTitle className="text-lg truncate">
                                        {selectedGroup ? formatClassLabel(selectedGroup) : 'Select a class group'}
                                    </CardTitle>
                                    <p className="text-sm text-muted-foreground truncate">
                                        {selectedGroup ? 'Messages from teachers and students in this class' : 'Choose a class on the left panel'}
                                    </p>
                                </div>
                            </div>
                            {effectiveSelectedClassId && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                                    {wsStatus === 'connected' ? (
                                        <><Wifi className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">Live</span></>
                                    ) : wsStatus === 'connecting' ? (
                                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span>Connecting…</span></>
                                    ) : (
                                        <><WifiOff className="h-3.5 w-3.5" /><span>Offline</span></>
                                    )}
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3 px-3 pb-3 pt-0 sm:space-y-4 sm:px-6 sm:pb-6">
                        <div className="h-[46vh] xl:h-[430px] overflow-y-auto rounded-lg border bg-muted/20 p-2.5 sm:p-3 space-y-3">
                            {!effectiveSelectedClassId ? (
                                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                                    Select a class group to view messages.
                                </div>
                            ) : messagesLoading ? (
                                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Loading messages...
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                                    No messages yet for this class.
                                </div>
                            ) : (
                                <>
                                    {hasNextPage ? (
                                        <div className="flex justify-center pb-2">
                                            <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                                                {isFetchingNextPage ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                                Load older messages
                                            </Button>
                                        </div>
                                    ) : null}
                                    {messages.map((message) => {
                                        const isMine = !!user?.id && user.id === message.sender_id
                                        return (
                                            <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[92%] sm:max-w-[80%] rounded-lg px-3 py-2 ${isMine ? 'bg-primary text-primary-foreground' : 'bg-background border'}`}>
                                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                        <span className="text-xs font-semibold">{isMine ? 'You' : message.sender_name}</span>
                                                        <Badge variant="outline" className="text-[10px] capitalize">
                                                            {message.sender_role || 'user'}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                                                    <p className={`text-[11px] mt-1 flex items-center gap-1 ${isMine ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                                                        <Calendar className="h-3 w-3" />
                                                        {new Date(message.created_at).toLocaleString()}
                                                    </p>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </>
                            )}
                        </div>

                        <form
                            onSubmit={onSend}
                            className="space-y-2.5 sm:space-y-3 sticky bottom-0 z-10 rounded-lg border bg-background/95 p-2.5 sm:p-3 backdrop-blur md:static md:rounded-none md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-0"
                        >
                            <Textarea
                                placeholder={effectiveSelectedClassId ? 'Type a message to this class group...' : 'Select a class group first'}
                                rows={3}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                disabled={!effectiveSelectedClassId || sendMutation.isPending}
                            />
                            <div className="flex justify-end">
                                <Button className="w-full sm:w-auto" type="submit" disabled={!effectiveSelectedClassId || sendMutation.isPending}>
                                    {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                                    Send
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </div>

            {/* Mobile Class Groups Drawer */}
            {mobileGroupsOpen && (
                <div className="fixed inset-0 z-50 xl:hidden">
                    <button
                        type="button"
                        aria-label="Close class groups"
                        className="absolute inset-0 bg-black/45"
                        onClick={() => setMobileGroupsOpen(false)}
                    />
                    <div className="absolute right-0 top-0 h-full w-[88vw] max-w-[360px] bg-background border-l shadow-xl flex flex-col">
                        <div className="flex items-center justify-between px-4 py-3 border-b">
                            <h3 className="font-semibold">Class Groups</h3>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMobileGroupsOpen(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="p-4 border-b">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search class groups..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                        </div>
                        <div className="p-4 overflow-y-auto flex-1">
                            {renderGroupList()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
