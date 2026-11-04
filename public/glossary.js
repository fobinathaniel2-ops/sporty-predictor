window.GLOSSARY = [
  { group: 'Match result', items: [
    ['1', 'Home team wins.'], ['X', 'The match ends in a draw.'], ['2', 'Away team wins.'],
    ['1X', 'Home team wins or draws.'], ['X2', 'Away team wins or draws.'], ['12', 'Either team wins; no draw.'],
  ]},
  { group: 'Goals', items: [
    ['Over 0.5', 'At least 1 goal.'], ['Over 1.5', 'At least 2 goals.'], ['Over 2.5', 'At least 3 goals.'], ['Over 3.5', 'At least 4 goals.'],
    ['Under 0.5', 'No goals.'], ['Under 1.5', 'Maximum 1 goal.'], ['Under 2.5', 'Maximum 2 goals.'], ['Under 3.5', 'Maximum 3 goals.'],
  ]},
  { group: 'Both Teams to Score (BTTS)', items: [
    ['BTTS Yes', 'Both teams score at least once.'], ['BTTS No', 'At least one team fails to score.'],
    ['BTTS & Over 2.5', 'Both teams score and there are at least 3 goals.'], ['BTTS & Over 1.5', 'Both teams score and there are at least 2 goals.'],
  ]},
  { group: 'Special', items: [
    ['Draw No Bet (DNB)', 'Draw is excluded as a result. If the match is drawn, the stake is generally returned.'],
    ['Handicap', 'One team gets a virtual advantage or disadvantage before the result is calculated (e.g. Home -1 starts a goal down). European and Asian systems differ.'],
    ['Correct score', 'Predicting the exact final score.'],
  ]},
  { group: 'Half-time', items: [
    ['HT 1 / HT X / HT 2', 'Result at half-time: home leads / draw / away leads.'], ['HT Over 0.5', 'At least one first-half goal.'],
    ['HT Under 1.5', 'Maximum one first-half goal.'], ['HT BTTS', 'Both teams score in the first half.'],
    ['HT/FT (e.g. 1/2)', 'Half-time result combined with the final result. 1/2 = home leads at HT but away wins.'],
  ]},
  { group: 'Team goals', items: [
    ['Home Over 0.5', 'Home team scores at least once.'], ['Home Over 1.5', 'Home team scores at least twice.'],
    ['Away Over 0.5', 'Away team scores at least once.'], ['Away Under 1.5', 'Away team scores no more than once.'],
  ]},
  { group: 'Other markets', items: [
    ['Clean Sheet', 'A team does not concede a goal.'], ['Win to Nil', 'A team wins without conceding.'],
    ['Odd / Even Goals', 'Total goals is an odd / even number.'], ['First / Last Goal', 'Which team scores first / last.'],
    ['Exact Goals', 'Exact total number of goals.'], ['Highest Scoring Half', 'Which half has more goals.'],
    ['Winning Margin', 'Number of goals by which a team wins.'], ['Total Corners / Cards', 'Number of corners / cards in the match.'],
  ]},
];
