/* eslint-disable @next/next/no-img-element -- standalone showcase bundle, not a Next page */
import React from "react"

/**
 * One real product screenshot with a light and dark capture. The showcase
 * theme lives on <html data-theme>, so CSS decides which of the two renders;
 * both stay in the accessibility tree only for the visible one.
 */
export function ShotImage({
  light,
  dark,
  alt,
  width,
  height,
  loading,
}: {
  light: string
  dark: string
  alt: string
  width: number
  height: number
  loading?: "lazy" | "eager"
}) {
  return (
    <>
      <img
        className="shot-light"
        src={`RoleSpecOS/${light}`}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
      />
      <img
        className="shot-dark"
        src={`RoleSpecOS/${dark}`}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
      />
    </>
  )
}
