.PHONY: build compile test clean install link-local

# Default target: verify the project compiles and tests pass
build:
	bun run tsc --noEmit
	bun test

# Compile a self-contained native binary named `gambit`
compile:
	bun build --compile --outfile=gambit src/gambit.tsx

# Run the test suite
test:
	bun test

# Remove compiled artifacts
clean:
	rm -f gambit

# Install the compiled binary locally to ~/.local/bin (or $GAMBIT_BIN_DIR)
install: compile
	./gambit install

# Link the source project globally via Bun (dev workflow)
link-local:
	bun link
