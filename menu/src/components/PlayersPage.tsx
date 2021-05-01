import React from "react";
import { Box, makeStyles, Theme } from "@material-ui/core";
import PlayerCard from "./PlayerCard";
import { PlayerPageHeader } from "./PlayerPageHeader";
import { useFilteredSortedPlayers } from "../state/players.state";

const useStyles = makeStyles((theme: Theme) => ({
  root: {
    backgroundColor: theme.palette.background.default,
    flexGrow: 1,
    borderRadius: 15,
    displayFlex: "column",
  },
  overrideWrapper: {
    display: "flex",
  },
  title: {
    fontWeight: 600,
  },
  playerCount: {
    color: theme.palette.text.secondary,
    fontWeight: 500,
  },
  playerGrid: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
  },
}));

export const PlayersPage: React.FC<{ visible: boolean }> = ({ visible }) => {
  const classes = useStyles();
  const players = useFilteredSortedPlayers();

  return (
    <Box
      className={classes.root}
      mt={2}
      mb={10}
      pt={4}
      px={4}
      visibility={visible ? "visible" : "hidden"}
    >
      <PlayerPageHeader />
      <Box py={2} className={classes.playerGrid}>
        {players.map((player) => (
          <PlayerCard {...player} key={player.id} />
        ))}
      </Box>
    </Box>
  );
};
