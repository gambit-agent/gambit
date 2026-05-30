.PHONY: help build typecheck compile test clean install link-local

.DEFAULT_GOAL := build

help:
	@printf "Gambit development targets:\n"
	@printf "  make build       Type-check and run tests\n"
	@printf "  make typecheck   Run TypeScript checks\n"
	@printf "  make test        Run Bun tests\n"
	@printf "  make compile     Build ./gambit native binary\n"
	@printf "  make install     Compile and install to ~/.local/bin\n"
	@printf "  make link-local  Link source checkout with bun link\n"
	@printf "  make clean       Remove compiled artifacts\n"

# Default target: verify the project compiles and tests pass.
build:
	bun run typecheck
	bun test

typecheck:
	bun run typecheck

# Compile a self-contained native binary named `gambit`.
compile:
	bun build --compile --outfile=gambit src/gambit.tsx

# Run the test suite.
test:
	bun test

# Remove compiled artifacts.
clean:
	rm -f gambit gambit.exe

# Install the compiled binary locally to ~/.local/bin (or $GAMBIT_BIN_DIR).
install: compile
	./gambit install

# Link the source project globally via Bun (dev workflow).
link-local:
	bun link
