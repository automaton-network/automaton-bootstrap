#!/bin/bash
mkdir -p diagrams

function create_diagram() {
  sol2uml ./contracts -b $1 -f png -o diagrams/$2.png
}

create_diagram "Proposals" "proposals"
create_diagram "KingAutomaton" "king-automaton"
create_diagram "DEX" "dex"
create_diagram "Util" "util"
