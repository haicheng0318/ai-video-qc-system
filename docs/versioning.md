# Product Versioning

The product release version has one source of truth: `PRODUCT_VERSION` in `packages/shared/src/product-version.ts`.

- **MAJOR** changes indicate incompatible product or API behavior.
- **MINOR** changes add backward-compatible product capabilities.
- **PATCH** changes deliver compatible fixes without changing the product contract.

The product version (currently V1.2.0) is independent from evaluation protocol, prompt, schema, rubric, scoring, and workflow versions. In particular, the product release must not rename the V1.1 evaluation protocol shown in business-facing content.

Build SHA is deployment metadata and may be shown when the build environment provides it; it is not a second product-version source.
