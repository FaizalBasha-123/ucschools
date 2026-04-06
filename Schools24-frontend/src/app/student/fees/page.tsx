"use client"

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
    CheckCircle, Clock, AlertCircle, CreditCard, Receipt, Download,
    ArrowLeft, Wallet, Calendar, CreditCardIcon,
    FileText, Sparkles
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { useStudentFees } from '@/hooks/useStudentFees'

export default function StudentFeesPage() {
    const router = useRouter()
    const { data, isLoading, isError } = useStudentFees(true)

    const feeBreakdown = data?.breakdown ?? []
    const paymentHistory = data?.payment_history ?? []
    const totalFees = data?.total_amount ?? 0
    const paidFees = data?.paid_amount ?? 0
    const pendingFees = data?.pending_amount ?? 0

    const handlePayNow = () => {
        toast.info('Coming soon', {
            description: 'Online payment integration will be available soon.',
        })
    }

    const handleDownloadReceipt = (receiptId: string) => {
        toast.success(`Downloading ${receiptId}...`, {
            description: 'Your receipt will be downloaded shortly.',
        })
    }

    const handleViewStatement = () => {
        toast.info('Generating fee statement...', {
            description: 'Your complete fee statement is being prepared.',
        })
    }

    return (
        <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/student/dashboard')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                            Fee Details
                        </h1>
                        <p className="text-muted-foreground">View and pay your school fees</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                    <Button variant="outline" onClick={handleViewStatement} className="w-full sm:w-auto">
                        <FileText className="mr-2 h-4 w-4" />
                        View Statement
                    </Button>
                    <Button
                        className="bg-gradient-to-r from-emerald-500 to-teal-600 border-0 shadow-lg shadow-emerald-500/20 opacity-60 cursor-not-allowed w-full sm:w-auto"
                        onClick={handlePayNow}
                        aria-disabled="true"
                    >
                        <CreditCard className="mr-2 h-4 w-4" />
                        Pay Now
                    </Button>
                </div>
            </div>

            {/* Fee Summary Cards */}
            <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-3">
                <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full -translate-y-12 translate-x-12" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/30">
                                <Wallet className="h-5 w-5 sm:h-8 sm:w-8" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-blue-700 dark:text-blue-400">{formatCurrency(totalFees)}</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Total Fees</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-full -translate-y-12 translate-x-12" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30">
                                <CheckCircle className="h-5 w-5 sm:h-8 sm:w-8" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-green-700 dark:text-green-400">{formatCurrency(paidFees)}</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Paid</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/50 dark:to-rose-950/50 overflow-hidden">
                    <CardContent className="p-3 sm:p-4 md:p-6 relative">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-full -translate-y-12 translate-x-12" />
                        <div className="flex items-center gap-2.5 sm:gap-4">
                            <div className="flex h-10 w-10 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/30">
                                <AlertCircle className="h-5 w-5 sm:h-8 sm:w-8" />
                            </div>
                            <div>
                                <p className="text-lg sm:text-xl md:text-3xl font-bold text-red-700 dark:text-red-400">{formatCurrency(pendingFees)}</p>
                                <p className="text-[11px] sm:text-sm text-muted-foreground">Pending</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Payment Progress */}
            <Card className="border-0 shadow-lg overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                    <CardDescription className="text-emerald-100">Academic Year 2025-26</CardDescription>
                </CardHeader>
                <CardContent className="p-4 md:p-6">
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <span className="font-medium">Overall Payment Status</span>
                            <Badge variant={pendingFees === 0 ? 'success' : 'warning'} className="text-sm px-4 py-1">
                                {pendingFees === 0 ? '✓ Fully Paid' : `${Math.round((paidFees / totalFees) * 100)}% Paid`}
                            </Badge>
                        </div>
                        <div className="relative">
                            <Progress value={(paidFees / totalFees) * 100} className="h-6 rounded-full" />
                            <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white drop-shadow">
                                {formatCurrency(paidFees)} / {formatCurrency(totalFees)}
                            </span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:justify-between text-sm gap-1.5 sm:gap-0">
                            <span className="text-green-600">Paid: {formatCurrency(paidFees)}</span>
                            <span className="text-red-600">Pending: {formatCurrency(pendingFees)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Fee Breakdown */}
            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                <CardTitle>Fee Breakdown</CardTitle>
                            </div>
                            <CardDescription>Individual fee components</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="text-sm text-muted-foreground">Loading fee breakdown...</div>
                        ) : null}
                        {isError ? (
                            <div className="text-sm text-destructive">Failed to load fee breakdown.</div>
                        ) : null}
                        {feeBreakdown.map((fee, index) => (
                            <div
                                key={fee.id}
                                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl border-2 transition-all duration-300 hover:shadow-lg ${fee.status === 'paid' ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20 hover:border-green-300' :
                                        fee.status === 'partial' ? 'border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20 hover:border-yellow-300' :
                                            'border-red-200 bg-red-50/50 dark:bg-red-950/20 hover:border-red-300'
                                    } stagger-${index + 1} animate-slide-up`}
                            >
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                    <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-muted text-2xl">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-base sm:text-lg">{fee.purpose_name}</p>
                                        <p className="text-xs sm:text-sm text-muted-foreground">
                                            {formatCurrency(fee.paid_amount)} / {formatCurrency(fee.amount)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
                                    <div className="text-left sm:text-right">
                                        <p className="font-bold text-base sm:text-lg">{formatCurrency(fee.amount - fee.paid_amount)}</p>
                                        <p className="text-[11px] sm:text-xs text-muted-foreground">Remaining</p>
                                    </div>
                                    <Badge variant={
                                        fee.status === 'paid' ? 'success' :
                                            fee.status === 'partial' ? 'warning' : 'destructive'
                                    } className="px-3 py-1.5 text-xs sm:text-sm font-medium">
                                        {fee.status === 'paid' && <CheckCircle className="h-3 w-3 mr-1" />}
                                        {fee.status === 'partial' && <Clock className="h-3 w-3 mr-1" />}
                                        {fee.status === 'pending' && <AlertCircle className="h-3 w-3 mr-1" />}
                                        {fee.status.charAt(0).toUpperCase() + fee.status.slice(1)}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                        {!isLoading && !isError && feeBreakdown.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No fee demands found.</div>
                        ) : null}
                    </div>
                </CardContent>
            </Card>

            {/* Payment History */}
            <Card className="border-0 shadow-lg">
                <CardHeader>
                    <div>
                        <div className="flex items-center gap-2">
                            <Receipt className="h-5 w-5 text-primary" />
                            <CardTitle>Payment History</CardTitle>
                        </div>
                        <CardDescription>
                            Your recent transactions • Academic Year {data?.academic_year || 'N/A'}
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="text-sm text-muted-foreground">Loading payment history...</div>
                        ) : null}
                        {isError ? (
                            <div className="text-sm text-destructive">Failed to load payment history.</div>
                        ) : null}
                        {paymentHistory.map((payment, index) => (
                            <div
                                key={payment.id}
                                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl border transition-all duration-300 hover:shadow-md bg-gradient-to-r from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20 stagger-${index + 1} animate-slide-up`}
                            >
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                    <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20">
                                        <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-base sm:text-lg">{formatCurrency(payment.amount)}</p>
                                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                                            <Calendar className="h-3 w-3" />
                                            <span>{new Date(payment.payment_date).toLocaleDateString()}</span>
                                            <span>•</span>
                                            <CreditCardIcon className="h-3 w-3" />
                                            <span>{payment.payment_method}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
                                    <Badge variant="success" className="px-2.5 sm:px-3 py-1 text-xs sm:text-sm">
                                        <Sparkles className="h-3 w-3 mr-1" />
                                        Success
                                    </Badge>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleDownloadReceipt(payment.receipt_number)}
                                        className="hover:bg-green-100 hover:text-green-700 hover:border-green-300 w-auto"
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Receipt
                                    </Button>
                                </div>
                            </div>
                        ))}
                        {!isLoading && !isError && paymentHistory.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No payments recorded yet.</div>
                        ) : null}
                    </div>
                </CardContent>
            </Card>

            {/* Payment CTA */}
            {pendingFees > 0 && (
                <Card className="border-0 shadow-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white overflow-hidden">
                    <CardContent className="p-4 md:p-8 relative">
                        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-20 translate-x-20" />
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-16 -translate-x-16" />
                        <div className="relative z-10 flex flex-col xl:flex-row items-center justify-between gap-4 xl:gap-6">
                            <div className="text-center md:text-left">
                                <h3 className="text-xl sm:text-2xl font-bold mb-2">Complete Your Payment</h3>
                                <p className="text-sm sm:text-base text-emerald-100">Pay the remaining {formatCurrency(pendingFees)} to avoid late fees</p>
                            </div>
                            <Button
                                size="lg"
                                className="bg-white text-emerald-600 shadow-xl px-8 opacity-60 cursor-not-allowed w-full sm:w-auto"
                                onClick={handlePayNow}
                                aria-disabled="true"
                            >
                                <CreditCard className="mr-2 h-5 w-5" />
                                {`Pay ${formatCurrency(pendingFees)}`}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
