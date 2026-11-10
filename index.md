---
layout: default
title: Romanized and translated lyrics for Spotify
---
{% capture my_readme %}{% include_relative README.md %}{% endcapture %}
{% comment %}The theme's header already shows the name and tagline: the README's heading and tagline are left out here.{% endcomment %}
{{ my_readme | replace: '# Spotify Karaoke', '' | replace: "**Romanized and translated lyrics for every song on Spotify's web player — plus the original script restored, and lyrics Spotify doesn't have.**", '' | replace: '> [!NOTE]', '> **Note:**' | replace: '> [!WARNING]', '> **Warning:**' | replace: '> [!IMPORTANT]', '> **Important:**' | replace: '<details>', '' | replace: '</details>', '' | replace: '<summary>Install from a release zip instead (developer mode)</summary>', '#### Install from a release zip instead (developer mode)' | replace: '<div align="center">', '<div align="center" markdown="1">' }}
