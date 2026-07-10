---
layout: default
---
{% capture my_readme %}{% include_relative README.md %}{% endcapture %}
{{ my_readme | replace: '> [!NOTE]', '> **Note:**' | replace: '> [!WARNING]', '> **Warning:**' | replace: '> [!IMPORTANT]', '> **Important:**' | replace: '<details>', '' | replace: '</details>', '' | replace: '<summary>Technical deep-dive</summary>', '### Technical deep-dive' | replace: '<div align="center">', '<div align="center" markdown="1">' }}
