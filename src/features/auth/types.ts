import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }

  interface User {
    role?: string
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string
    role: string
    profileRefreshedAt?: number
    /** Epoch ms of the user's `passwordChangedAt` when this token was minted. */
    passwordStampedAt?: number
    /** The user's `sessionVersion` when this token was minted or last refreshed. */
    sessionVersion?: number
  }
}
