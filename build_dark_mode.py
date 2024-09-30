def line_as_darkmode(arg = ''):
    if not arg or not isinstance(arg, str) or len(arg) < 1: return ''
    if not "var(" in arg: return arg  # Skip lines that are not REFERENCING CSS variables
    lineSplit   = arg.split("var(")
    varStart    = lineSplit[1] if len(lineSplit) > 1 else None
    if not varStart: return arg # skip junk lines
    varSplit    = varStart.split(")") # split the variable name and trailing css like " !important;" or ";"
    if len(varSplit) != 2: return arg # skip junk lines
    return lineSplit[0] + "var(" + varSplit[0] + "_darkmode)" + varSplit[1] # return the dark mode variable

# Read the original CSS file
lines = []
with open('monitor.css', 'r') as file:
    lines = file.readlines()

# error
if not lines or len(lines) < 20:
    print("Error reading CSS file")
    exit()

# Clear the file
with open('monitor_dark.css', 'w') as file:
    file.write("") 

# write lines to dark mode file
with open('monitor_dark.css', 'a') as file:
    for line in lines:
        file.write(line_as_darkmode(line))

print("Dark mode CSS file created: monitor_dark.css")