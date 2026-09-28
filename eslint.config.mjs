import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const config = [
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react's version auto-detect calls an API ESLint 10 removed.
  { settings: { react: { version: "19" } } },
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "public/**"] },
]

export default config
