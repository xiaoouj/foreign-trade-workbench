# Third-party notices

The MIT license at the repository root covers the project's original source.
Dependencies installed through npm retain their own licenses; their upstream license files and notices must be preserved in redistributed builds.

The runtime uses mammoth, mysql2, pdf-parse, pdfjs-dist and xlsx, with versions and integrity hashes recorded in package-lock.json. The optional connectors have a separate package.json and are not installed by the main application.

The private deployment previously included a third-party 3D packing solver marked GPL-3.0 with the Commons Clause. That solver, its integration code and bundled graphics library are excluded from this MIT release. They are not relicensed by this repository.
