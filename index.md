---
layout: default
---
{% capture my_readme %}{% include_relative README.md %}{% endcapture %}
{{ my_readme | replace: '> [!NOTE]', '> **Note:**' | replace: '> [!WARNING]', '> **Warning:**' | replace: '> [!IMPORTANT]', '> **Important:**' | replace: '<details>', '<details markdown="1">' | replace: '<summary>Technical deep-dive</summary>', '<summary markdown="1">Technical deep-dive</summary>' | replace: '<div align="center">', '<div align="center" markdown="1">' }}
