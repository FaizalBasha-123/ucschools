package com.schools24.app.ui.teacher

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.schools24.app.domain.model.AdminTimetableEntry
import com.schools24.app.domain.model.TeacherClassPerformance
import com.schools24.app.domain.model.TeacherDashboardData
import com.schools24.app.domain.model.TeacherStudentOption
import com.schools24.app.ui.components.S24Badge
import com.schools24.app.ui.components.S24Card
import com.schools24.app.ui.components.S24EmptyState
import com.schools24.app.ui.components.S24ErrorState
import com.schools24.app.ui.components.S24LoadingShimmer
import com.schools24.app.ui.components.S24SearchBar
import com.schools24.app.viewmodel.TeacherAttendanceUiState
import com.schools24.app.viewmodel.TeacherDashboardUiState
import com.schools24.app.viewmodel.TeacherTimetableUiState
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

@Composable
fun TeacherDashboardScreen(
    state: TeacherDashboardUiState,
    onRefresh: () -> Unit,
    onOpenTeach: () -> Unit,
    onOpenAttendance: () -> Unit,
    onOpenQuizScheduler: () -> Unit,
    onOpenMaterials: () -> Unit,
    onOpenQuestionPapers: () -> Unit,
    onOpenHomework: () -> Unit,
    onOpenFees: () -> Unit,
    onOpenLeaderboard: () -> Unit,
) {
    when {
        state.isLoading && state.dashboard == null -> S24LoadingShimmer("Loading dashboard...")
        state.errorMessage != null && state.dashboard == null -> S24ErrorState(state.errorMessage, onRetry = onRefresh)
        else -> {
            val dashboard = state.dashboard ?: emptyTeacherDashboard()
            val quickActions = listOf(
                TeacherQuickAction("Start Class", Icons.Default.PlayArrow, listOf(Color(0xFF14B8A6), Color(0xFF059669)), onOpenTeach),
                TeacherQuickAction("Take Attendance", Icons.Default.FactCheck, listOf(Color(0xFF22C55E), Color(0xFF16A34A)), onOpenAttendance),
                TeacherQuickAction("Create Quiz", Icons.Default.Quiz, listOf(Color(0xFF2DD4BF), Color(0xFF06B6D4)), onOpenQuizScheduler),
                TeacherQuickAction("Upload Material", Icons.Default.MenuBook, listOf(Color(0xFF10B981), Color(0xFF047857)), onOpenMaterials),
            )
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "Welcome back, ${dashboard.teacher?.fullName?.ifBlank { "Teacher" } ?: "Teacher"}!",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "Here's what's on your schedule today.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        quickActions.chunked(2).forEach { rowItems ->
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                                rowItems.forEach { action ->
                                    QuickActionCard(
                                        label = action.label,
                                        icon = action.icon,
                                        colors = action.colors,
                                        modifier = Modifier.weight(1f),
                                        onClick = action.onClick,
                                    )
                                }
                                if (rowItems.size == 1) {
                                    Spacer(modifier = Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }

                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                        TeacherStatCard("${dashboard.todayUniqueClasses}", "Total Classes", "${dashboard.todayUniqueClasses} Today", listOf(Color(0xFF14B8A6), Color(0xFF059669)), Icons.Default.MenuBook, Modifier.weight(1f))
                        TeacherStatCard("${dashboard.totalStudents}", "Total Students", "Active", listOf(Color(0xFF22C55E), Color(0xFF16A34A)), Icons.Default.People, Modifier.weight(1f))
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                        TeacherStatCard("${dashboard.pendingHomeworkToGrade}", "Pending Reviews", "${dashboard.pendingHomeworkToGrade} Pending", listOf(Color(0xFFF59E0B), Color(0xFFD97706)), Icons.Default.FactCheck, Modifier.weight(1f))
                        TeacherStatCard(
                            value = dashboard.teacher?.rating?.let { String.format("%.1f", it) } ?: "0.0",
                            title = "Your Rating",
                            note = starsForRating(dashboard.teacher?.rating ?: 0.0),
                            colors = listOf(Color(0xFF6366F1), Color(0xFF7C3AED)),
                            icon = Icons.Default.Star,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                item {
                    S24Card {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Class Performance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text("Average scores across your classes", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (dashboard.classPerformance.isEmpty()) {
                                Text("No class performance data available yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                dashboard.classPerformance.forEach { PerformanceBar(it) }
                            }
                        }
                    }
                }

                item {
                    S24Card {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("Scheduled Quizzes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                S24Badge("${dashboard.upcomingQuizzes.size}")
                            }
                            if (dashboard.upcomingQuizzes.isEmpty()) {
                                Text("No quizzes found", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                dashboard.upcomingQuizzes.take(3).forEach { quiz ->
                                    S24Card(modifier = Modifier.fillMaxWidth()) {
                                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Text(quiz.title, fontWeight = FontWeight.Medium)
                                            Text("${quiz.subjectName} • ${quiz.className}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            Text(
                                                if (quiz.isAnytime) "Anytime • ${quiz.durationMinutes} mins" else "${formatPrettyDateTime(quiz.scheduledAt)} • ${quiz.durationMinutes} mins",
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                item {
                    S24Card {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Student Activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            if (dashboard.recentStudentActivity.isEmpty()) {
                                Text("No recent homework submissions", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            } else {
                                dashboard.recentStudentActivity.take(4).forEach { activity ->
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(activity.studentName, fontWeight = FontWeight.Medium)
                                            Text("${activity.homeworkTitle} • ${formatPrettyDateTime(activity.submittedAt)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        S24Badge(if (activity.status == "graded") "Graded" else "Submitted")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TeacherTimetableScreen(state: TeacherTimetableUiState, onRefresh: () -> Unit) {
    when {
        state.isLoading && state.config == null -> S24LoadingShimmer("Loading timetable...")
        state.errorMessage != null && state.config == null -> S24ErrorState(state.errorMessage, onRetry = onRefresh)
        else -> {
            val config = state.config
            val days = config?.days?.filter { it.isActive }?.sortedBy { it.dayOfWeek }.orEmpty()
            val periods = config?.periods?.sortedBy { it.periodNumber }.orEmpty()
            val scrollState = rememberScrollState()

            Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("My Timetable", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Your teaching schedule", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (days.isEmpty() || periods.isEmpty()) {
                    S24EmptyState("No timetable", "No timetable configuration available.")
                } else {
                    Box(modifier = Modifier.fillMaxSize().horizontalScroll(scrollState)) {
                        Column(modifier = Modifier.width((100 + periods.size * 168).dp)) {
                            Row(modifier = Modifier.fillMaxWidth()) {
                                TimetableHeaderCell("Day", 100.dp)
                                periods.forEachIndexed { index, period ->
                                    TimetableHeaderCell("P${index + 1}\n${period.startTime} - ${period.endTime}", 168.dp)
                                }
                            }
                            days.forEach { day ->
                                Row(modifier = Modifier.fillMaxWidth()) {
                                    TimetableDayCell(day.dayName, 100.dp)
                                    periods.forEach { period ->
                                        val entry = state.timetable.firstOrNull {
                                            it.dayOfWeek == day.dayOfWeek && it.periodNumber == period.periodNumber
                                        }
                                        if (period.isBreak) {
                                            TimetableBreakCell(period.breakName ?: "Break", 168.dp)
                                        } else {
                                            TimetableEntryCell(entry, 168.dp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeacherAttendanceScreen(
    state: TeacherAttendanceUiState,
    onClassChange: (String) -> Unit,
    onDateChange: (String) -> Unit,
    onSearchChange: (String) -> Unit,
    onStatusChange: (String, String) -> Unit,
    onMarkAllPresent: () -> Unit,
    onMarkAllAbsent: () -> Unit,
    onSave: () -> Unit,
    onMessageShown: () -> Unit,
) {
    val filteredStudents = remember(state.students, state.searchQuery) {
        state.students.filter {
            state.searchQuery.isBlank() ||
                it.fullName.contains(state.searchQuery, ignoreCase = true) ||
                it.rollNumber.contains(state.searchQuery, ignoreCase = true)
        }
    }
    val presentCount = state.attendanceMap.values.count { it == "present" }
    val absentCount = state.attendanceMap.values.count { it == "absent" }
    val lateCount = state.attendanceMap.values.count { it == "late" }
    val notMarked = (state.students.size - presentCount - absentCount - lateCount).coerceAtLeast(0)

    LaunchedEffect(state.errorMessage, state.actionMessage) {
        if (state.errorMessage != null || state.actionMessage != null) onMessageShown()
    }

    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Attendance", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Mark attendance for your assigned classes only", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick = onSave, enabled = state.selectedClassId.isNotBlank() && state.attendanceMap.isNotEmpty() && !state.isSaving) {
                Text(if (state.isSaving) "Saving..." else "Save")
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            DropdownFieldTeacher("Class", state.classes.map { it.classId to it.className }, state.selectedClassId, onClassChange, Modifier.weight(1f))
            OutlinedTextField(
                value = state.selectedDate,
                onValueChange = onDateChange,
                label = { Text("Date") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            TeacherStatCard("$presentCount", "Present", "Marked", listOf(Color(0xFF16A34A), Color(0xFF15803D)), Icons.Default.FactCheck, Modifier.weight(1f))
            TeacherStatCard("$absentCount", "Absent", "Marked", listOf(Color(0xFFEF4444), Color(0xFFDC2626)), Icons.Default.Block, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            TeacherStatCard("${state.students.size}", "Total Students", "Listed", listOf(Color(0xFF3B82F6), Color(0xFF2563EB)), Icons.Default.People, Modifier.weight(1f))
            TeacherStatCard("$notMarked", "Not Marked", "Pending", listOf(Color(0xFFF59E0B), Color(0xFFD97706)), Icons.Default.QuestionMark, Modifier.weight(1f))
        }

        S24Card(modifier = Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Mark Attendance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Only students assigned to the selected class are listed", color = MaterialTheme.colorScheme.onSurfaceVariant)
                S24SearchBar(value = state.searchQuery, onValueChange = onSearchChange, label = "Search students...")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onMarkAllPresent, enabled = state.students.isNotEmpty()) { Text("Mark All Present") }
                    TextButton(onClick = onMarkAllAbsent, enabled = state.students.isNotEmpty()) { Text("Mark All Absent") }
                }
            }
        }

        when {
            state.isLoading -> S24LoadingShimmer("Loading attendance...")
            state.errorMessage != null && state.students.isEmpty() -> S24ErrorState(state.errorMessage)
            filteredStudents.isEmpty() -> S24EmptyState("No students found", "No students found for this class.")
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                    itemsIndexed(filteredStudents) { index, student ->
                        AttendanceStudentCard(
                            index = index,
                            student = student,
                            status = state.attendanceMap[student.id],
                            onStatusChange = { onStatusChange(student.id, it) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickActionCard(
    label: String,
    icon: ImageVector,
    colors: List<Color>,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    S24Card(modifier = modifier) {
        Button(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
            contentPadding = PaddingValues(0.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Transparent)
                    .padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(
                    modifier = Modifier
                        .width(56.dp)
                        .height(56.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Brush.linearGradient(colors)),
                contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = label, tint = Color.White)
                }
                Text(label, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun TeacherStatCard(
    value: String,
    title: String,
    note: String,
    colors: List<Color>,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    S24Card(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier
                    .width(48.dp)
                    .height(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(colors)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = title, tint = Color.White)
            }
            S24Badge(note)
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private data class TeacherQuickAction(
    val label: String,
    val icon: ImageVector,
    val colors: List<Color>,
    val onClick: () -> Unit,
)

@Composable
private fun PerformanceBar(item: TeacherClassPerformance) {
    val fraction = (item.averageScore / 100.0).coerceIn(0.0, 1.0).toFloat()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(item.className, fontWeight = FontWeight.Medium)
            Text("${item.averageScore.toInt()}%", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(10.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(10.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xFF10B981)),
            )
        }
    }
}

@Composable
private fun TimetableHeaderCell(text: String, width: Dp) {
    Box(
        modifier = Modifier
            .width(width)
            .height(64.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun TimetableDayCell(text: String, width: Dp) {
    Box(
        modifier = Modifier
            .width(width)
            .height(96.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun TimetableBreakCell(text: String, width: Dp) {
    Box(
        modifier = Modifier
            .width(width)
            .height(96.dp)
            .background(Color(0xFFECFDF5))
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color(0xFF16A34A), fontWeight = FontWeight.Bold)
    }
}
@Composable
private fun TimetableEntryCell(entry: AdminTimetableEntry?, width: Dp) {
    Box(
        modifier = Modifier
            .width(width)
            .height(96.dp)
            .padding(4.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (entry == null) {
            S24Badge("Free")
        } else {
            val colors = subjectColors(entry.subjectName)
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(colors))
                    .padding(8.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(entry.subjectName, color = Color.White, fontWeight = FontWeight.Bold)
                    Text("Class ${entry.className}", color = Color.White.copy(alpha = 0.92f), style = MaterialTheme.typography.bodySmall)
                    Text(entry.roomNumber ?: "-", color = Color.White.copy(alpha = 0.92f), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun AttendanceStudentCard(index: Int, student: TeacherStudentOption, status: String?, onStatusChange: (String) -> Unit) {
    S24Card(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("${index + 1}. ${student.fullName}", fontWeight = FontWeight.SemiBold)
                    Text("Roll: ${student.rollNumber.ifBlank { "-" }}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                S24Badge(status?.replaceFirstChar { it.uppercase() } ?: "Not Marked")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                AttendanceAction("Present", status == "present", Color(0xFF16A34A), Modifier.weight(1f)) { onStatusChange("present") }
                AttendanceAction("Absent", status == "absent", Color(0xFFDC2626), Modifier.weight(1f)) { onStatusChange("absent") }
                AttendanceAction("Late", status == "late", Color(0xFF2563EB), Modifier.weight(1f)) { onStatusChange("late") }
            }
        }
    }
}

@Composable
private fun AttendanceAction(label: String, selected: Boolean, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) color else Color.Transparent,
            contentColor = if (selected) Color.White else color,
        ),
    ) {
        Text(label)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropdownFieldTeacher(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.first == selected }?.second.orEmpty()
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }, modifier = modifier) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            modifier = Modifier.menuAnchor().fillMaxWidth(),
            singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text, modifier = Modifier.wrapContentWidth()) }, onClick = { expanded = false; onSelected(value) })
            }
        }
    }
}

private fun emptyTeacherDashboard(): TeacherDashboardData = TeacherDashboardData(
    teacher = null,
    todaySchedule = emptyList(),
    todayUniqueClasses = 0,
    assignedClassCount = 0,
    pendingHomeworkToGrade = 0,
    homeworkSubmitted = 0,
    teacherRank = 0,
    totalStudents = 0,
    classPerformance = emptyList(),
    upcomingQuizzes = emptyList(),
    recentStudentActivity = emptyList(),
)

private fun starsForRating(rating: Double): String {
    val count = rating.toInt().coerceIn(0, 5)
    return "★".repeat(count).ifBlank { "Not rated" }
}

private fun subjectColors(subject: String): List<Color> = when (subject) {
    "Mathematics" -> listOf(Color(0xFF3B82F6), Color(0xFF06B6D4))
    "Physics" -> listOf(Color(0xFF8B5CF6), Color(0xFFA855F7))
    "Chemistry", "Science" -> listOf(Color(0xFF22C55E), Color(0xFF10B981))
    "English" -> listOf(Color(0xFFF97316), Color(0xFFF59E0B))
    "Hindi" -> listOf(Color(0xFFEC4899), Color(0xFFF43F5E))
    "History" -> listOf(Color(0xFFEF4444), Color(0xFFF43F5E))
    "Geography" -> listOf(Color(0xFF14B8A6), Color(0xFF06B6D4))
    "Computer Science" -> listOf(Color(0xFF64748B), Color(0xFF475569))
    else -> listOf(Color(0xFF6B7280), Color(0xFF475569))
}

private fun formatPrettyDateTime(value: String): String {
    return runCatching {
        OffsetDateTime.parse(value).format(DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a"))
    }.getOrElse {
        runCatching {
            LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd MMM yyyy"))
        }.getOrDefault(value.ifBlank { "—" })
    }
}
