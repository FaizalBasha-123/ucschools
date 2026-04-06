package com.schools24.app.data.remote.dto

import com.google.gson.annotations.SerializedName
import com.schools24.app.domain.model.AuthUser
import com.schools24.app.domain.model.UserRole

data class LoginRequestDto(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String,
)

data class AuthUserDto(
    @SerializedName("id") val id: String,
    @SerializedName("email") val email: String,
    @SerializedName("role") val role: String,
    @SerializedName("full_name") val fullName: String,
    @SerializedName("phone") val phone: String? = null,
    @SerializedName("profile_picture_url") val profilePictureUrl: String? = null,
    @SerializedName("school_id") val schoolId: String? = null,
    @SerializedName("school_name") val schoolName: String? = null,
    @SerializedName("login_count") val loginCount: Int? = null,
)

data class LoginResponseDto(
    @SerializedName("access_token") val token: String,
    @SerializedName("user") val user: AuthUserDto,
)

fun AuthUserDto.toDomain(): AuthUser = AuthUser(
    id = id,
    email = email,
    role = UserRole.fromApi(role),
    fullName = fullName,
    phone = phone,
    profilePictureUrl = profilePictureUrl,
    schoolId = schoolId,
    schoolName = schoolName,
    loginCount = loginCount,
)
