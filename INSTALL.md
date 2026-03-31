# Installation Instructions

To run Gambit with just  instead of , follow these steps:

## Option 1: Local Development (Recommended)

Install the package locally to make the  command available:



This will create a symlink in your global Bun bin directory, allowing you to run  from anywhere.

## Option 2: Global Installation

Install globally:



## Option 3: Manual Setup (Alternative)

If the above doesn't work, you can create a manual alias:

### Bash/Zsh
Add to your ~/.bashrc or ~/.zshrc:


### PowerShell
Add to your PowerShell profile:


### Windows CMD
Create a batch file gambit.bat in a directory in your PATH:


## For Your Current Setup (Windows + WSL)

Since you're using WSL with Windows, you have a few options:

1. **In WSL (bash):**
   

2. **In PowerShell:**
   

3. **In CMD:**
   Create :
   

## Verification

After installation, test it:


The application should start just like running 
