import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: '../api/schema.gql',
  documents: ['src/lib/queries.ts'],
  generates: {
    'src/gql/generated.ts': {
      plugins: ['typescript', 'typescript-operations'],
      config: {
        // Le schéma déclare `DateTime` (scalaire de NestJS) : sans cette
        // correspondance, la codegen le rendrait `any`. Les dates arrivent
        // en chaînes ISO dans le JSON — jamais en objets `Date`.
        scalars: { DateTime: 'string' },
        avoidOptionals: true,
        skipTypename: true,
        enumsAsTypes: true,
      },
    },
  },
}

export default config
